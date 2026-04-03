import { useState, useRef, useEffect, useCallback } from "react";
import { Student, AttendanceSession, AttendanceRecord } from "@/api/entities";
import { useNavigate } from "react-router-dom";

const FACE_API_CDN = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
const MODELS_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

let faceApiLoaded = false;
let modelsLoaded = false;

async function loadFaceApi() {
  if (faceApiLoaded && window.faceapi) return window.faceapi;
  return new Promise((resolve, reject) => {
    if (window.faceapi) { faceApiLoaded = true; resolve(window.faceapi); return; }
    const existing = document.querySelector(`script[src="${FACE_API_CDN}"]`);
    if (existing) {
      const wait = () => window.faceapi ? resolve(window.faceapi) : setTimeout(wait, 100);
      wait(); return;
    }
    const script = document.createElement("script");
    script.src = FACE_API_CDN;
    script.onload = () => { faceApiLoaded = true; resolve(window.faceapi); };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function loadModels(faceapi) {
  if (modelsLoaded) return;
  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri(MODELS_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL),
  ]);
  modelsLoaded = true;
}

export default function Attendance() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const fileVideoRef = useRef(null);
  const fileCanvasRef = useRef(null);
  const faceapiRef = useRef(null);
  const intervalRef = useRef(null);
  const labeledDescriptorsRef = useRef([]);

  const [mode, setMode] = useState("setup"); // setup | live | upload | processing | results
  const [inputType, setInputType] = useState("webcam"); // webcam | upload
  const [loading, setLoading] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [students, setStudents] = useState([]);
  const [session, setSession] = useState(null);
  const [detectedFaces, setDetectedFaces] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [liveStats, setLiveStats] = useState({ detected: 0, identified: 0 });
  const [uploadedVideo, setUploadedVideo] = useState(null);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [sessionSaved, setSessionSaved] = useState(false);

  const [sessionForm, setSessionForm] = useState({
    subject: "", department: "Computer Science", semester: "3rd",
    time_slot: "09:00 - 10:00"
  });

  useEffect(() => {
    loadStudentData();
  }, []);

  const loadStudentData = async () => {
    try {
      const data = await Student.list();
      setStudents(data);
    } catch (e) {}
  };

  const initSystem = async () => {
    if (!sessionForm.subject) { setError("Please enter a subject name"); return; }
    if (students.length === 0) { setError("No students enrolled. Please enroll students first."); return; }
    setLoading(true);
    setError("");

    try {
      const faceapi = await loadFaceApi();
      faceapiRef.current = faceapi;
      await loadModels(faceapi);
      setModelsReady(true);

      // Build labeled face descriptors from enrolled students
      const validStudents = students.filter(s => s.face_descriptor && s.face_descriptor !== "null");
      if (validStudents.length === 0) {
        setError("No students with face data found. Please enroll students with face scans.");
        setLoading(false);
        return;
      }

      const labeledDescriptors = validStudents.map(s => {
        try {
          const descriptorArray = JSON.parse(s.face_descriptor);
          const float32 = new Float32Array(descriptorArray);
          return new faceapi.LabeledFaceDescriptors(
            `${s.name}||${s.roll_number}||${s.id}`,
            [float32]
          );
        } catch (e) {
          return null;
        }
      }).filter(Boolean);

      labeledDescriptorsRef.current = labeledDescriptors;

      // Create session
      const today = new Date().toISOString().split("T")[0];
      const newSession = await AttendanceSession.create({
        session_name: `${sessionForm.subject} - ${sessionForm.department} Sem ${sessionForm.semester}`,
        subject: sessionForm.subject,
        department: sessionForm.department,
        semester: sessionForm.semester,
        date: today,
        time_slot: sessionForm.time_slot,
        status: "Active",
        total_students: validStudents.length,
        present_count: 0,
        video_processed: false
      });
      setSession(newSession);

      // Initialize attendance map (all absent)
      const initAtt = {};
      validStudents.forEach(s => {
        initAtt[s.id] = { student: s, status: "Absent", confidence: 0, timestamp: null };
      });
      setAttendance(initAtt);

      if (inputType === "webcam") {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "environment" }
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setMode("live");
        startLiveDetection(faceapi, labeledDescriptors, newSession);
      } else {
        setMode("upload");
      }
    } catch (e) {
      setError("Failed to initialize: " + e.message);
    }
    setLoading(false);
  };

  const startLiveDetection = (faceapi, labeledDescriptors, sess) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const matcher = new faceapi.FaceMatcher(labeledDescriptors, 0.5); // 0.5 threshold

    intervalRef.current = setInterval(async () => {
      if (!videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;

      try {
        const detections = await faceapi
          .detectAllFaces(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
          .withFaceLandmarks()
          .withFaceDescriptors();

        const dims = faceapi.matchDimensions(canvas, { width: video.videoWidth, height: video.videoHeight }, true);
        const resized = faceapi.resizeResults(detections, dims);

        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let identifiedCount = 0;
        const faceInfos = [];

        for (const d of resized) {
          const bestMatch = matcher.findBestMatch(d.descriptor);
          const isKnown = bestMatch.label !== "unknown";
          const confidence = Math.round((1 - bestMatch.distance) * 100);

          let label = "Unknown";
          let studentId = null;
          if (isKnown) {
            const parts = bestMatch.label.split("||");
            label = parts[0];
            studentId = parts[2];
            identifiedCount++;
          }

          // Draw box
          const box = d.detection.box;
          const color = isKnown ? "#10b981" : "#ef4444";
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.strokeRect(box.x, box.y, box.width, box.height);

          // Draw label bg
          ctx.fillStyle = color;
          ctx.fillRect(box.x, box.y - 28, box.width, 28);
          ctx.fillStyle = "white";
          ctx.font = "bold 14px sans-serif";
          ctx.fillText(isKnown ? `${label} (${confidence}%)` : "Unknown", box.x + 6, box.y - 8);

          faceInfos.push({ label, confidence, isKnown, studentId });

          // Mark present if confidence > 60%
          if (isKnown && studentId && confidence > 60) {
            setAttendance(prev => {
              if (prev[studentId] && prev[studentId].status !== "Present") {
                const updated = { ...prev };
                updated[studentId] = { ...updated[studentId], status: "Present", confidence, timestamp: new Date().toLocaleTimeString() };
                return updated;
              }
              return prev;
            });
          }
        }

        setLiveStats({ detected: detections.length, identified: identifiedCount });
        setDetectedFaces(faceInfos);
      } catch (e) {}
    }, 300);
  };

  const processUploadedVideo = async () => {
    if (!uploadedVideo || !faceapiRef.current || !labeledDescriptorsRef.current.length) return;
    setMode("processing");
    setProcessingProgress(0);

    const faceapi = faceapiRef.current;
    const labeledDescriptors = labeledDescriptorsRef.current;
    const matcher = new faceapi.FaceMatcher(labeledDescriptors, 0.5);

    const video = fileVideoRef.current;
    const canvas = fileCanvasRef.current;

    await new Promise(res => {
      video.onloadedmetadata = res;
      video.src = uploadedVideo;
      video.load();
    });

    const duration = video.duration;
    const frameInterval = 1.0; // sample every 1 second
    const totalFrames = Math.floor(duration / frameInterval);
    let frame = 0;

    const processFrame = () => {
      return new Promise(resolve => {
        video.currentTime = frame * frameInterval;
        video.onseeked = async () => {
          try {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0);

            const detections = await faceapi
              .detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
              .withFaceLandmarks()
              .withFaceDescriptors();

            for (const d of detections) {
              const bestMatch = matcher.findBestMatch(d.descriptor);
              if (bestMatch.label !== "unknown") {
                const parts = bestMatch.label.split("||");
                const studentId = parts[2];
                const confidence = Math.round((1 - bestMatch.distance) * 100);

                if (confidence > 60) {
                  setAttendance(prev => {
                    if (prev[studentId] && prev[studentId].status !== "Present") {
                      const updated = { ...prev };
                      updated[studentId] = {
                        ...updated[studentId],
                        status: "Present",
                        confidence,
                        timestamp: `${Math.floor(frame * frameInterval / 60)}:${String(Math.round((frame * frameInterval) % 60)).padStart(2, "0")}`
                      };
                      return updated;
                    }
                    return prev;
                  });
                }
              }
            }
          } catch (e) {}
          resolve();
        };
      });
    };

    for (let i = 0; i <= totalFrames; i++) {
      frame = i;
      await processFrame();
      setProcessingProgress(Math.round((i / totalFrames) * 100));
    }

    setMode("results");
  };

  const finalizeSession = async () => {
    if (!session) return;
    setProcessing(true);

    const presentList = Object.values(attendance).filter(a => a.status === "Present");
    const absentList = Object.values(attendance).filter(a => a.status === "Absent");

    // Save all records
    const records = Object.values(attendance).map(a => ({
      session_id: session.id,
      student_id: a.student.id,
      student_name: a.student.name,
      roll_number: a.student.roll_number,
      status: a.status,
      confidence: a.confidence || 0,
      timestamp: a.timestamp || new Date().toISOString(),
      marked_by: a.confidence > 0 ? "Face Recognition" : "Manual"
    }));

    for (const rec of records) {
      await AttendanceRecord.create(rec);
    }

    await AttendanceSession.update(session.id, {
      status: "Completed",
      present_count: presentList.length,
      video_processed: true
    });

    setSessionSaved(true);
    setProcessing(false);
  };

  const stopLive = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setMode("results");
  };

  const toggleManual = (studentId) => {
    setAttendance(prev => {
      const updated = { ...prev };
      const current = updated[studentId];
      updated[studentId] = {
        ...current,
        status: current.status === "Present" ? "Absent" : "Present",
        marked_by: "Manual",
        timestamp: current.status === "Present" ? null : new Date().toLocaleTimeString()
      };
      return updated;
    });
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  const presentCount = Object.values(attendance).filter(a => a.status === "Present").length;
  const totalCount = Object.values(attendance).length;
  const percentage = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => navigate("/")} className="text-slate-400 hover:text-white transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-3xl font-bold text-white">Mark Attendance</h1>
            <p className="text-blue-400 text-sm">Phase 2: Video face recognition for attendance</p>
          </div>
        </div>

        {/* Setup */}
        {mode === "setup" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6">
              <h2 className="text-white font-bold text-xl mb-6">Session Setup</h2>
              {error && <p className="text-red-400 bg-red-500/10 rounded-lg px-3 py-2 mb-4 text-sm">{error}</p>}

              <div className="space-y-4">
                <div>
                  <label className="text-slate-400 text-sm mb-1 block">Subject *</label>
                  <input
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="e.g., Data Structures, DBMS"
                    value={sessionForm.subject}
                    onChange={e => setSessionForm({ ...sessionForm, subject: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-slate-400 text-sm mb-1 block">Department</label>
                    <select className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                      value={sessionForm.department} onChange={e => setSessionForm({ ...sessionForm, department: e.target.value })}>
                      {["Computer Science", "Electronics", "Mechanical", "Civil", "IT"].map(d => (
                        <option key={d} value={d} className="bg-slate-800">{d}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 text-sm mb-1 block">Semester</label>
                    <select className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                      value={sessionForm.semester} onChange={e => setSessionForm({ ...sessionForm, semester: e.target.value })}>
                      {["1st","2nd","3rd","4th","5th","6th","7th","8th"].map(s => (
                        <option key={s} value={s} className="bg-slate-800">{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-slate-400 text-sm mb-1 block">Time Slot</label>
                  <select className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                    value={sessionForm.time_slot} onChange={e => setSessionForm({ ...sessionForm, time_slot: e.target.value })}>
                    {["08:00 - 09:00","09:00 - 10:00","10:00 - 11:00","11:00 - 12:00","12:00 - 13:00","13:00 - 14:00","14:00 - 15:00","15:00 - 16:00"].map(t => (
                      <option key={t} value={t} className="bg-slate-800">{t}</option>
                    ))}
                  </select>
                </div>

                {/* Input type */}
                <div>
                  <label className="text-slate-400 text-sm mb-2 block">Video Input</label>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { id: "webcam", label: "Live Webcam", icon: "🎥", desc: "Real-time classroom camera" },
                      { id: "upload", label: "Upload Video", icon: "📂", desc: "Process recorded video file" }
                    ].map(opt => (
                      <button key={opt.id} onClick={() => setInputType(opt.id)}
                        className={`p-4 rounded-xl border text-left transition-all ${inputType === opt.id ? "border-blue-500 bg-blue-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>
                        <div className="text-2xl mb-1">{opt.icon}</div>
                        <div className="text-white font-medium text-sm">{opt.label}</div>
                        <div className="text-slate-400 text-xs">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3">
                  <p className="text-blue-400 text-sm">
                    <span className="font-bold">📊 {students.length} students</span> enrolled with face data.
                    {students.length === 0 && " Please enroll students first."}
                  </p>
                </div>

                <button onClick={initSystem} disabled={loading || students.length === 0}
                  className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold py-4 rounded-xl hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {loading ? (
                    <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Loading AI Models...</>
                  ) : (
                    <>🚀 Start Attendance Session</>
                  )}
                </button>
              </div>
            </div>

            <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6">
              <h2 className="text-white font-bold text-xl mb-4">How It Works</h2>
              <div className="space-y-4">
                {[
                  { step: "1", title: "Face Detection", desc: "SSD MobileNet V1 (high-accuracy) scans every frame to locate all faces in the classroom simultaneously", color: "bg-blue-500" },
                  { step: "2", title: "Face Embedding", desc: "FaceNet-based recognition network extracts 128-dimensional face embeddings from each detected face", color: "bg-purple-500" },
                  { step: "3", title: "KNN Matching", desc: "Euclidean distance matching against enrolled face descriptors with 0.5 threshold (≥60% confidence = Present)", color: "bg-emerald-500" },
                  { step: "4", title: "Attendance Update", desc: "Matched students marked Present with confidence score, timestamp, and 'Face Recognition' label", color: "bg-orange-500" }
                ].map(s => (
                  <div key={s.step} className="flex gap-4">
                    <div className={`w-8 h-8 rounded-full ${s.color} flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}>{s.step}</div>
                    <div>
                      <p className="text-white font-medium">{s.title}</p>
                      <p className="text-slate-400 text-sm">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Live Mode */}
        {mode === "live" && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2">
              <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-white font-bold">LIVE — {session?.subject}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="bg-blue-500/20 text-blue-400 px-3 py-1 rounded-full text-sm">👥 {liveStats.detected} detected</span>
                    <span className="bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full text-sm">✅ {liveStats.identified} identified</span>
                  </div>
                </div>
                <div className="relative bg-black rounded-xl overflow-hidden" style={{ aspectRatio: "16/9" }}>
                  <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                  <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
                </div>
                <div className="flex gap-3 mt-4">
                  <button onClick={stopLive}
                    className="flex-1 bg-gradient-to-r from-red-500 to-rose-600 text-white font-bold py-3 rounded-xl hover:opacity-90 transition-all">
                    ⏹ Stop & View Results
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-bold">Live Roster</h3>
                <div className="text-emerald-400 font-bold">{presentCount}/{totalCount}</div>
              </div>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {Object.entries(attendance).map(([id, a]) => (
                  <div key={id} className={`flex items-center gap-2 p-2 rounded-lg transition-all ${a.status === "Present" ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-white/5"}`}>
                    {a.student.face_image_url ? (
                      <img src={a.student.face_image_url} className="w-8 h-8 rounded-full object-cover" alt="" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-sm font-bold">
                        {a.student.name?.charAt(0)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-medium truncate">{a.student.name}</p>
                      <p className="text-slate-500 text-xs">{a.student.roll_number}</p>
                    </div>
                    <div className="text-right">
                      {a.status === "Present" ? (
                        <span className="text-emerald-400 text-xs font-bold">{a.confidence}%</span>
                      ) : (
                        <span className="text-slate-500 text-xs">Absent</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Upload mode */}
        {mode === "upload" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6">
              <h2 className="text-white font-bold text-xl mb-4">Upload Classroom Video</h2>
              <div
                className="border-2 border-dashed border-white/20 rounded-xl p-12 text-center hover:border-blue-500/50 transition-colors cursor-pointer"
                onClick={() => document.getElementById("videoUpload").click()}
                onDrop={e => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file && file.type.startsWith("video/")) {
                    setUploadedVideo(URL.createObjectURL(file));
                  }
                }}
                onDragOver={e => e.preventDefault()}
              >
                <input id="videoUpload" type="file" accept="video/*" className="hidden"
                  onChange={e => {
                    const file = e.target.files[0];
                    if (file) setUploadedVideo(URL.createObjectURL(file));
                  }} />
                <div className="text-6xl mb-4">🎬</div>
                <p className="text-white font-bold text-lg">Drop video file here</p>
                <p className="text-slate-400 text-sm mt-2">MP4, MOV, AVI, WebM supported</p>
                {uploadedVideo && <p className="text-emerald-400 mt-3 text-sm font-medium">✅ Video loaded</p>}
              </div>

              {uploadedVideo && (
                <video src={uploadedVideo} className="w-full rounded-xl mt-4 max-h-48 object-contain bg-black" controls />
              )}

              <canvas ref={fileCanvasRef} className="hidden" />
              <video ref={fileVideoRef} className="hidden" muted crossOrigin="anonymous" />

              {uploadedVideo && (
                <button onClick={processUploadedVideo}
                  className="w-full mt-4 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold py-4 rounded-xl hover:opacity-90 transition-all flex items-center justify-center gap-2">
                  🔍 Process Video & Detect Faces
                </button>
              )}
            </div>

            <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6">
              <h2 className="text-white font-bold text-xl mb-4">Enrolled Students</h2>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {Object.entries(attendance).map(([id, a]) => (
                  <div key={id} className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                    <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-sm">
                      {a.student.name?.charAt(0)}
                    </div>
                    <div className="flex-1">
                      <p className="text-white text-sm font-medium">{a.student.name}</p>
                      <p className="text-slate-500 text-xs">{a.student.roll_number}</p>
                    </div>
                    <span className="text-slate-500 text-sm">Waiting...</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Processing */}
        {mode === "processing" && (
          <div className="max-w-2xl mx-auto text-center py-20">
            <div className="w-24 h-24 mx-auto mb-6 bg-blue-500/20 rounded-full flex items-center justify-center">
              <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            </div>
            <h2 className="text-white font-bold text-2xl mb-2">Processing Video</h2>
            <p className="text-slate-400 mb-8">Analyzing frames for face detection and recognition...</p>
            <div className="bg-white/10 rounded-full h-3 mb-3">
              <div className="bg-gradient-to-r from-blue-500 to-indigo-600 h-3 rounded-full transition-all duration-300"
                style={{ width: `${processingProgress}%` }} />
            </div>
            <p className="text-slate-400 text-sm">{processingProgress}% complete — sampling every 1 second</p>
          </div>
        )}

        {/* Results */}
        {mode === "results" && (
          <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Present", value: presentCount, color: "text-emerald-400", bg: "from-emerald-500/20 to-teal-500/10", border: "border-emerald-500/30" },
                { label: "Absent", value: totalCount - presentCount, color: "text-red-400", bg: "from-red-500/20 to-rose-500/10", border: "border-red-500/30" },
                { label: "Attendance %", value: `${percentage}%`, color: "text-blue-400", bg: "from-blue-500/20 to-indigo-500/10", border: "border-blue-500/30" }
              ].map(s => (
                <div key={s.label} className={`bg-gradient-to-br ${s.bg} border ${s.border} rounded-2xl p-6 text-center`}>
                  <div className={`text-4xl font-bold ${s.color}`}>{s.value}</div>
                  <div className="text-slate-400 mt-1">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Attendance table */}
            <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-bold text-xl">Attendance Register — {session?.subject}</h2>
                <div className="text-slate-400 text-sm">{session?.date} · {session?.time_slot}</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left text-slate-400 text-sm pb-3 font-medium">Student</th>
                      <th className="text-left text-slate-400 text-sm pb-3 font-medium">Roll No</th>
                      <th className="text-left text-slate-400 text-sm pb-3 font-medium">Status</th>
                      <th className="text-left text-slate-400 text-sm pb-3 font-medium">Confidence</th>
                      <th className="text-left text-slate-400 text-sm pb-3 font-medium">Time</th>
                      <th className="text-left text-slate-400 text-sm pb-3 font-medium">Manual Override</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(attendance).map(([id, a]) => (
                      <tr key={id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            {a.student.face_image_url ? (
                              <img src={a.student.face_image_url} className="w-8 h-8 rounded-full object-cover" alt="" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-sm font-bold">
                                {a.student.name?.charAt(0)}
                              </div>
                            )}
                            <span className="text-white font-medium">{a.student.name}</span>
                          </div>
                        </td>
                        <td className="py-3 text-slate-400">{a.student.roll_number}</td>
                        <td className="py-3">
                          <span className={`px-3 py-1 rounded-full text-xs font-bold ${a.status === "Present" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                            {a.status}
                          </span>
                        </td>
                        <td className="py-3">
                          {a.confidence > 0 ? (
                            <div className="flex items-center gap-2">
                              <div className="w-16 bg-white/10 rounded-full h-1.5">
                                <div className="bg-emerald-400 h-1.5 rounded-full" style={{ width: `${a.confidence}%` }} />
                              </div>
                              <span className="text-slate-400 text-xs">{a.confidence}%</span>
                            </div>
                          ) : (
                            <span className="text-slate-600 text-xs">—</span>
                          )}
                        </td>
                        <td className="py-3 text-slate-400 text-sm">{a.timestamp || "—"}</td>
                        <td className="py-3">
                          <button onClick={() => toggleManual(id)}
                            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${a.status === "Present" ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"}`}>
                            Mark {a.status === "Present" ? "Absent" : "Present"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 flex gap-3">
                {!sessionSaved ? (
                  <button onClick={finalizeSession} disabled={processing}
                    className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold px-8 py-3 rounded-xl hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-2">
                    {processing ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</> : "💾 Save Attendance"}
                  </button>
                ) : (
                  <div className="bg-emerald-500/20 border border-emerald-500/40 rounded-xl px-6 py-3 text-emerald-400 font-bold">
                    ✅ Attendance saved to database!
                  </div>
                )}
                <button onClick={() => navigate("/dashboard")}
                  className="bg-white/10 text-white font-bold px-6 py-3 rounded-xl hover:bg-white/20 transition-colors">
                  📊 View Reports
                </button>
                <button onClick={() => navigate("/attendance")}
                  className="bg-white/10 text-white font-bold px-6 py-3 rounded-xl hover:bg-white/20 transition-colors">
                  ➕ New Session
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
