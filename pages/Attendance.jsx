import { useState, useRef, useEffect } from "react";
import { Student, AttendanceSession, AttendanceRecord } from "@/api/entities";
import { useNavigate } from "react-router-dom";

const FACE_API_CDN = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
const MODELS_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

// ─── CLASSROOM-GRADE CONSTANTS ──────────────────────────────────────────────
// Lower minConfidence so SSD doesn't miss small/distant faces
const DETECT_OPTIONS = { minConfidence: 0.3 };
// Match threshold: 0.55 is more lenient than default 0.6 — helps for far faces
const MATCH_THRESHOLD = 0.55;
// Minimum confidence % to auto-mark present (lower for back-bench recognition)
const PRESENT_THRESHOLD = 45;
// Frames sampled per second during video processing (higher = more chances to catch each student)
const FRAMES_PER_SEC = 3;
// Upscale factor: we render frames at 2x to catch small faces at the back
const UPSCALE = 2;

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

/**
 * CLAHE-like contrast enhancement on a canvas frame.
 * Boosts brightness/contrast so dim back-bench faces become more detectable.
 */
function enhanceFrame(canvas) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // Compute histogram for luminance
  const hist = new Array(256).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
    hist[lum]++;
  }
  const total = w * h;

  // CDF → equalization map
  const cdf = new Array(256).fill(0);
  cdf[0] = hist[0];
  for (let i = 1; i < 256; i++) cdf[i] = cdf[i-1] + hist[i];
  const cdfMin = cdf.find(v => v > 0);
  const lut = cdf.map(v => Math.round(((v - cdfMin) / (total - cdfMin)) * 255));

  // Apply LUT — blend 40% equalized + 60% original to avoid over-brightening
  for (let i = 0; i < data.length; i += 4) {
    data[i]   = Math.round(0.6 * data[i]   + 0.4 * lut[data[i]]);
    data[i+1] = Math.round(0.6 * data[i+1] + 0.4 * lut[data[i+1]]);
    data[i+2] = Math.round(0.6 * data[i+2] + 0.4 * lut[data[i+2]]);
  }
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Upscale a video frame onto a larger canvas so small back-bench
 * faces become large enough for the detector to catch them.
 */
function upscaleFrameToCanvas(source, scale) {
  const c = document.createElement("canvas");
  c.width = source.videoWidth * scale;
  c.height = source.videoHeight * scale;
  c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
  return c;
}

function upscaleCanvasToCanvas(source, scale) {
  const c = document.createElement("canvas");
  c.width = source.width * scale;
  c.height = source.height * scale;
  c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
  return c;
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
  const matcherRef = useRef(null);
  const attendanceRef = useRef({}); // live reference so interval can read latest

  const [mode, setMode] = useState("setup");
  const [inputType, setInputType] = useState("upload");
  const [loading, setLoading] = useState(false);
  const [students, setStudents] = useState([]);
  const [session, setSession] = useState(null);
  const [attendance, setAttendance] = useState({});
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [liveStats, setLiveStats] = useState({ detected: 0, identified: 0, frames: 0 });
  const [uploadedVideo, setUploadedVideo] = useState(null);
  const [uploadedVideoName, setUploadedVideoName] = useState("");
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingStage, setProcessingStage] = useState("");
  const [sessionSaved, setSessionSaved] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  const [sessionForm, setSessionForm] = useState({
    subject: "", department: "Computer Science", semester: "3rd",
    time_slot: "09:00 - 10:00"
  });

  useEffect(() => { loadStudentData(); }, []);

  const loadStudentData = async () => {
    try { const data = await Student.list(); setStudents(data); } catch (e) {}
  };

  // Keep attendanceRef in sync for use inside intervals
  useEffect(() => { attendanceRef.current = attendance; }, [attendance]);

  // ─── INIT: load models, build matcher, create session ────────────────────
  const initSystem = async () => {
    if (!sessionForm.subject.trim()) { setError("Please enter a subject name"); return; }
    if (students.length === 0) { setError("No students enrolled. Please enroll students first."); return; }
    setLoading(true);
    setError("");

    try {
      const faceapi = await loadFaceApi();
      faceapiRef.current = faceapi;
      setProcessingStage("Loading AI models...");
      await loadModels(faceapi);

      const validStudents = students.filter(s => s.face_descriptor && s.face_descriptor !== "null");
      if (validStudents.length === 0) {
        setError("No students with face data. Please enroll students with face scans first.");
        setLoading(false);
        return;
      }

      setProcessingStage("Building face matcher...");
      const labeledDescriptors = validStudents.map(s => {
        try {
          const arr = JSON.parse(s.face_descriptor);
          return new faceapi.LabeledFaceDescriptors(
            `${s.name}||${s.roll_number}||${s.id}`,
            [new Float32Array(arr)]
          );
        } catch { return null; }
      }).filter(Boolean);

      labeledDescriptorsRef.current = labeledDescriptors;
      matcherRef.current = new faceapi.FaceMatcher(labeledDescriptors, MATCH_THRESHOLD);

      // Create session record
      const today = new Date().toISOString().split("T")[0];
      const newSession = await AttendanceSession.create({
        session_name: `${sessionForm.subject} — ${sessionForm.department} Sem ${sessionForm.semester}`,
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

      // Init attendance map — all absent
      const initAtt = {};
      validStudents.forEach(s => {
        initAtt[s.id] = { student: s, status: "Absent", confidence: 0, timestamp: null, hitCount: 0 };
      });
      setAttendance(initAtt);
      attendanceRef.current = initAtt;

      if (inputType === "webcam") {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: "environment" }
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setMode("live");
        startLiveDetection(faceapi);
      } else {
        setMode("upload");
      }
    } catch (e) {
      setError("Failed to initialize: " + e.message);
    }
    setLoading(false);
    setProcessingStage("");
  };

  // ─── LIVE WEBCAM DETECTION ───────────────────────────────────────────────
  const startLiveDetection = (faceapi) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    let frameCount = 0;

    intervalRef.current = setInterval(async () => {
      if (!videoRef.current || !canvasRef.current || !matcherRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      frameCount++;

      try {
        // Upscale frame for back-bench detection
        const scaled = upscaleFrameToCanvas(video, UPSCALE);
        enhanceFrame(scaled);

        const detections = await faceapi
          .detectAllFaces(scaled, new faceapi.SsdMobilenetv1Options(DETECT_OPTIONS))
          .withFaceLandmarks()
          .withFaceDescriptors();

        // Scale detections back to display size
        const displayW = video.videoWidth, displayH = video.videoHeight;
        faceapi.matchDimensions(canvas, { width: displayW, height: displayH }, true);

        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let identifiedCount = 0;

        for (const d of detections) {
          const bestMatch = matcherRef.current.findBestMatch(d.descriptor);
          const isKnown = bestMatch.label !== "unknown";
          const confidence = Math.round((1 - bestMatch.distance) * 100);

          // Scale box back to display coords
          const box = {
            x: d.detection.box.x / UPSCALE,
            y: d.detection.box.y / UPSCALE,
            width: d.detection.box.width / UPSCALE,
            height: d.detection.box.height / UPSCALE,
          };

          const color = isKnown ? "#10b981" : "#ef4444";
          ctx.strokeStyle = color;
          ctx.lineWidth = isKnown ? 3 : 2;
          ctx.strokeRect(box.x, box.y, box.width, box.height);

          const fontSize = Math.max(11, Math.min(16, box.width * 0.18));
          ctx.font = `bold ${fontSize}px sans-serif`;
          const parts = isKnown ? bestMatch.label.split("||") : [];
          const labelText = isKnown ? `${parts[0]} (${confidence}%)` : "Unknown";
          const textW = ctx.measureText(labelText).width + 10;

          ctx.fillStyle = color + "dd";
          ctx.fillRect(box.x, box.y - fontSize - 6, textW, fontSize + 6);
          ctx.fillStyle = "white";
          ctx.fillText(labelText, box.x + 5, box.y - 4);

          if (isKnown) {
            identifiedCount++;
            const studentId = parts[2];
            if (confidence >= PRESENT_THRESHOLD) {
              setAttendance(prev => {
                const cur = prev[studentId];
                if (!cur) return prev;
                const newHits = (cur.hitCount || 0) + 1;
                // Require 2+ consistent hits before marking present (anti-false-positive)
                if (cur.status !== "Present" && newHits >= 2) {
                  return { ...prev, [studentId]: { ...cur, status: "Present", confidence, timestamp: new Date().toLocaleTimeString(), hitCount: newHits } };
                }
                return { ...prev, [studentId]: { ...cur, hitCount: newHits, confidence: Math.max(cur.confidence, confidence) } };
              });
            }
          }
        }

        setLiveStats({ detected: detections.length, identified: identifiedCount, frames: frameCount });
      } catch (e) {}
    }, 500); // 2fps live — balances CPU and responsiveness
  };

  // ─── VIDEO UPLOAD PROCESSING ─────────────────────────────────────────────
  const processUploadedVideo = async () => {
    if (!uploadedVideo || !faceapiRef.current || !matcherRef.current) return;
    setMode("processing");
    setProcessingProgress(0);

    const faceapi = faceapiRef.current;
    const video = fileVideoRef.current;
    const canvas = fileCanvasRef.current;

    setProcessingStage("Loading video metadata...");
    await new Promise(res => {
      video.onloadedmetadata = res;
      video.src = uploadedVideo;
      video.load();
    });

    const duration = video.duration;
    const step = 1 / FRAMES_PER_SEC;
    const totalFrames = Math.floor(duration / step);

    setProcessingStage(`Processing ${totalFrames} frames at ${FRAMES_PER_SEC}fps sampling...`);

    for (let i = 0; i <= totalFrames; i++) {
      const t = i * step;

      await new Promise(res => {
        video.currentTime = t;
        video.onseeked = async () => {
          try {
            // Draw at native resolution first
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0);

            // Upscale for back-bench detection
            const scaled = upscaleCanvasToCanvas(canvas, UPSCALE);
            enhanceFrame(scaled);

            const detections = await faceapi
              .detectAllFaces(scaled, new faceapi.SsdMobilenetv1Options(DETECT_OPTIONS))
              .withFaceLandmarks()
              .withFaceDescriptors();

            for (const d of detections) {
              const bestMatch = matcherRef.current.findBestMatch(d.descriptor);
              if (bestMatch.label === "unknown") continue;

              const parts = bestMatch.label.split("||");
              const studentId = parts[2];
              const confidence = Math.round((1 - bestMatch.distance) * 100);

              if (confidence >= PRESENT_THRESHOLD) {
                setAttendance(prev => {
                  const cur = prev[studentId];
                  if (!cur) return prev;
                  const newHits = (cur.hitCount || 0) + 1;
                  if (cur.status === "Present") {
                    // Update to highest confidence seen
                    return confidence > cur.confidence
                      ? { ...prev, [studentId]: { ...cur, confidence, hitCount: newHits } }
                      : { ...prev, [studentId]: { ...cur, hitCount: newHits } };
                  }
                  // Need at least 2 hits across frames to mark present (reduces false positives)
                  if (newHits >= 2) {
                    const mm = Math.floor(t / 60);
                    const ss = String(Math.round(t % 60)).padStart(2, "0");
                    return { ...prev, [studentId]: { ...cur, status: "Present", confidence, timestamp: `${mm}:${ss}`, hitCount: newHits } };
                  }
                  return { ...prev, [studentId]: { ...cur, hitCount: newHits, confidence: Math.max(cur.confidence, confidence) } };
                });
              }
            }
          } catch (e) {}
          res();
        };
      });

      const pct = Math.round((i / totalFrames) * 100);
      setProcessingProgress(pct);
      if (i % 10 === 0) {
        const presentNow = Object.values(attendanceRef.current).filter(a => a.status === "Present").length;
        setProcessingStage(`Frame ${i}/${totalFrames} — ${presentNow} students identified so far...`);
      }
    }

    setMode("results");
    setProcessingStage("Done!");
  };

  // ─── FINALIZE & SAVE SESSION ──────────────────────────────────────────────
  const finalizeSession = async () => {
    if (!session) return;
    setProcessing(true);

    const attValues = Object.values(attendance);
    const presentList = attValues.filter(a => a.status === "Present");

    const records = attValues.map(a => ({
      session_id: session.id,
      student_id: a.student.id,
      student_name: a.student.name,
      roll_number: a.student.roll_number,
      status: a.status,
      confidence: a.confidence || 0,
      timestamp: a.timestamp || new Date().toISOString(),
      marked_by: a.confidence > 0 ? "Face Recognition" : "Manual"
    }));

    for (const rec of records) await AttendanceRecord.create(rec);

    await AttendanceSession.update(session.id, {
      status: "Completed",
      present_count: presentList.length,
      video_processed: true
    });

    setSessionSaved(true);
    setSuccessMsg(`✅ Saved! ${presentList.length}/${attValues.length} students marked present.`);
    setProcessing(false);
  };

  const stopLive = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setMode("results");
  };

  const toggleManual = (studentId) => {
    setAttendance(prev => {
      const cur = prev[studentId];
      return {
        ...prev,
        [studentId]: {
          ...cur,
          status: cur.status === "Present" ? "Absent" : "Present",
          marked_by: "Manual",
          timestamp: cur.status === "Present" ? null : new Date().toLocaleTimeString(),
          confidence: cur.status === "Present" ? 0 : 100
        }
      };
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-4 md:p-6">
      <div className="max-w-7xl mx-auto">

        {/* ── HEADER ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => navigate("/")} className="text-slate-400 hover:text-white transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">Mark Attendance</h1>
            <p className="text-blue-400 text-sm">Classroom video face recognition — back-bench optimized</p>
          </div>
        </div>

        {/* ── SETUP ───────────────────────────────────────────────── */}
        {mode === "setup" && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Form */}
            <div className="lg:col-span-3 bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6">
              <h2 className="text-white font-bold text-xl mb-5">📋 New Session</h2>
              {error && <p className="text-red-400 bg-red-500/10 rounded-lg px-3 py-2 mb-4 text-sm">{error}</p>}

              <div className="space-y-4">
                <div>
                  <label className="text-slate-400 text-sm mb-1 block">Subject *</label>
                  <input
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    placeholder="e.g., Data Structures, DBMS"
                    value={sessionForm.subject}
                    onChange={e => setSessionForm({ ...sessionForm, subject: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-slate-400 text-sm mb-1 block">Department</label>
                    <select className="w-full bg-slate-800 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                      value={sessionForm.department} onChange={e => setSessionForm({ ...sessionForm, department: e.target.value })}>
                      {["Computer Science","Electronics","Mechanical","Civil","IT"].map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 text-sm mb-1 block">Semester</label>
                    <select className="w-full bg-slate-800 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                      value={sessionForm.semester} onChange={e => setSessionForm({ ...sessionForm, semester: e.target.value })}>
                      {["1st","2nd","3rd","4th","5th","6th","7th","8th"].map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-slate-400 text-sm mb-1 block">Time Slot</label>
                  <select className="w-full bg-slate-800 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                    value={sessionForm.time_slot} onChange={e => setSessionForm({ ...sessionForm, time_slot: e.target.value })}>
                    {["08:00 - 09:00","09:00 - 10:00","10:00 - 11:00","11:00 - 12:00","12:00 - 13:00","13:00 - 14:00","14:00 - 15:00","15:00 - 16:00"].map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                {/* Video input selector */}
                <div>
                  <label className="text-slate-400 text-sm mb-2 block">Video Input Method</label>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { id: "upload", label: "Upload Classroom Video", icon: "📂", desc: "MP4/MOV file from classroom camera — recommended" },
                      { id: "webcam", label: "Live Webcam", icon: "🎥", desc: "Real-time from laptop/USB camera" }
                    ].map(opt => (
                      <button key={opt.id} onClick={() => setInputType(opt.id)}
                        className={`p-4 rounded-xl border text-left transition-all ${inputType === opt.id ? "border-blue-500 bg-blue-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>
                        <div className="text-2xl mb-1">{opt.icon}</div>
                        <div className="text-white font-semibold text-sm">{opt.label}</div>
                        <div className="text-slate-400 text-xs mt-0.5">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <button onClick={initSystem} disabled={loading || students.length === 0}
                  className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold py-4 rounded-xl hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {loading ? (
                    <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />{processingStage || "Initializing..."}</>
                  ) : (
                    <>🚀 Start Session</>
                  )}
                </button>
              </div>
            </div>

            {/* Info panel */}
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-5">
                <p className="text-emerald-400 font-bold mb-1">👥 {students.length} Students Ready</p>
                <p className="text-slate-400 text-sm">Face embeddings loaded for matching</p>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-5 space-y-3">
                <p className="text-blue-400 font-bold text-sm">🏫 Classroom Video Tips</p>
                {[
                  "Record from the front of the classroom facing all students",
                  "Use 1080p or higher if possible — more detail at the back",
                  "Good room lighting helps significantly",
                  "Pan slowly across the class or use a wide-angle lens",
                  "Even a 30-second clip is enough — we sample every frame",
                ].map((tip, i) => (
                  <div key={i} className="flex gap-2 text-xs text-slate-300">
                    <span className="text-blue-400 flex-shrink-0">•</span>
                    <span>{tip}</span>
                  </div>
                ))}
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-2">
                <p className="text-slate-400 font-bold text-sm">⚙️ Detection Settings</p>
                {[
                  ["Detector", "SSD MobileNet V1 (minConf: 0.3)"],
                  ["Frame upscale", `${UPSCALE}× — catches small back faces`],
                  ["Enhancement", "Histogram equalization per frame"],
                  ["Match threshold", `${MATCH_THRESHOLD} (lenient for distance)`],
                  ["Present threshold", `≥${PRESENT_THRESHOLD}% confidence`],
                  ["Frame sampling", `${FRAMES_PER_SEC} frames/sec`],
                  ["Anti-false-positive", "Requires 2+ detections per student"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-slate-500">{k}</span>
                    <span className="text-slate-300 font-mono">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── LIVE WEBCAM ─────────────────────────────────────────── */}
        {mode === "live" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                <div className="relative bg-black" style={{ aspectRatio: "16/9" }}>
                  <video ref={videoRef} className="w-full h-full object-contain" muted playsInline />
                  <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
                  {/* Live stats bar */}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur px-4 py-2 flex items-center justify-between">
                    <div className="flex gap-4 text-xs">
                      <span className="text-slate-400">Frames: <span className="text-white font-bold">{liveStats.frames}</span></span>
                      <span className="text-slate-400">Detected: <span className="text-yellow-400 font-bold">{liveStats.detected}</span></span>
                      <span className="text-slate-400">Identified: <span className="text-emerald-400 font-bold">{liveStats.identified}</span></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                      <span className="text-red-400 text-xs font-bold">LIVE</span>
                    </div>
                  </div>
                </div>
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-white font-bold">{presentCount}/{totalCount} Present</p>
                    <p className="text-slate-400 text-sm">Attendance auto-updating in real-time</p>
                  </div>
                  <button onClick={stopLive}
                    className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold px-6 py-3 rounded-xl hover:opacity-90 transition-all">
                    ⏹ End Session
                  </button>
                </div>
              </div>
            </div>
            <AttendanceSidebar attendance={attendance} presentCount={presentCount} totalCount={totalCount} percentage={percentage} onToggle={toggleManual} live />
          </div>
        )}

        {/* ── VIDEO UPLOAD ─────────────────────────────────────────── */}
        {mode === "upload" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white/5 border border-white/10 rounded-2xl p-6">
              <h2 className="text-white font-bold text-xl mb-5">📂 Upload Classroom Video</h2>

              {!uploadedVideo ? (
                <label className="flex flex-col items-center gap-4 border-2 border-dashed border-white/20 rounded-2xl py-16 px-8 text-center cursor-pointer hover:border-blue-500/50 hover:bg-white/5 transition-all group">
                  <input type="file" accept="video/*" className="hidden" onChange={e => {
                    const f = e.target.files[0];
                    if (f) { setUploadedVideo(URL.createObjectURL(f)); setUploadedVideoName(f.name); }
                  }} />
                  <div className="text-6xl group-hover:scale-110 transition-transform">🎬</div>
                  <div>
                    <p className="text-white font-bold text-lg">Drop classroom video here</p>
                    <p className="text-slate-400 text-sm mt-1">MP4, MOV, AVI, WebM — any resolution</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-xs text-center mt-2">
                    {[
                      ["📹", "From front", "covering all benches"],
                      ["💡", "Well lit", "or flash enabled"],
                      ["⏱️", "Any length", "we sample every ⅓ sec"]
                    ].map(([icon, title, sub]) => (
                      <div key={title} className="bg-white/5 rounded-xl p-3">
                        <div className="text-2xl">{icon}</div>
                        <div className="text-slate-300 font-medium mt-1">{title}</div>
                        <div className="text-slate-500">{sub}</div>
                      </div>
                    ))}
                  </div>
                </label>
              ) : (
                <div>
                  <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 mb-4 flex items-center gap-3">
                    <span className="text-2xl">✅</span>
                    <div>
                      <p className="text-white font-semibold">{uploadedVideoName}</p>
                      <p className="text-emerald-400 text-sm">Video loaded — ready to process</p>
                    </div>
                    <button onClick={() => { setUploadedVideo(null); setUploadedVideoName(""); }}
                      className="ml-auto text-slate-500 hover:text-red-400 transition-colors">✕</button>
                  </div>
                  <video ref={fileVideoRef} className="hidden" />
                  <canvas ref={fileCanvasRef} className="hidden" />

                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 mb-4 space-y-1">
                    <p className="text-blue-400 font-semibold text-sm">What happens next:</p>
                    {[
                      `Samples ${FRAMES_PER_SEC} frames per second from the video`,
                      `Upscales each frame ${UPSCALE}× so back-bench faces are detectable`,
                      "Applies histogram equalization to handle poor lighting",
                      `Matches every face found against all ${students.length} enrolled students`,
                      "Requires 2+ matches per student to confirm presence (anti-false-positive)",
                    ].map((s, i) => <p key={i} className="text-slate-300 text-xs">• {s}</p>)}
                  </div>

                  <button onClick={processUploadedVideo}
                    className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold py-4 rounded-xl hover:opacity-90 transition-all flex items-center justify-center gap-2 text-lg">
                    🔍 Process Video & Mark Attendance
                  </button>
                </div>
              )}
            </div>
            <AttendanceSidebar attendance={attendance} presentCount={presentCount} totalCount={totalCount} percentage={percentage} onToggle={toggleManual} />
          </div>
        )}

        {/* ── PROCESSING ──────────────────────────────────────────── */}
        {mode === "processing" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white/5 border border-white/10 rounded-2xl p-8">
              <h2 className="text-white font-bold text-xl mb-6 flex items-center gap-3">
                <div className="w-8 h-8 border-3 border-blue-500/30 border-t-blue-500 rounded-full animate-spin border-[3px]" />
                Analyzing Classroom Video
              </h2>

              {/* Progress */}
              <div className="mb-6">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-slate-400">Progress</span>
                  <span className="text-white font-bold">{processingProgress}%</span>
                </div>
                <div className="bg-white/10 rounded-full h-4 overflow-hidden">
                  <div className="bg-gradient-to-r from-blue-500 to-indigo-600 h-4 rounded-full transition-all duration-300 flex items-center justify-end pr-2"
                    style={{ width: `${processingProgress}%` }}>
                    {processingProgress > 10 && <span className="text-white text-xs font-bold">{processingProgress}%</span>}
                  </div>
                </div>
                <p className="text-slate-400 text-xs mt-2">{processingStage}</p>
              </div>

              {/* Live result preview */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                {[
                  { label: "Present", value: presentCount, color: "text-emerald-400", bg: "bg-emerald-500/10" },
                  { label: "Absent", value: totalCount - presentCount, color: "text-red-400", bg: "bg-red-500/10" },
                  { label: "Attendance", value: `${percentage}%`, color: "text-blue-400", bg: "bg-blue-500/10" },
                ].map(s => (
                  <div key={s.label} className={`${s.bg} rounded-xl p-4 text-center`}>
                    <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
                    <div className="text-slate-400 text-sm mt-1">{s.label}</div>
                  </div>
                ))}
              </div>

              <div className="bg-slate-800/50 rounded-xl p-4">
                <p className="text-slate-400 text-xs text-center">
                  ⚡ Processing with {UPSCALE}× upscaling + histogram enhancement + {FRAMES_PER_SEC}fps sampling<br/>
                  <span className="text-slate-500">Do not close this tab. Results update in real-time above.</span>
                </p>
              </div>
            </div>
            <AttendanceSidebar attendance={attendance} presentCount={presentCount} totalCount={totalCount} percentage={percentage} onToggle={toggleManual} processing />
          </div>
        )}

        {/* ── RESULTS ─────────────────────────────────────────────── */}
        {mode === "results" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              {/* Summary card */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-white font-bold text-xl">📊 Session Results</h2>
                  {!sessionSaved && (
                    <button onClick={finalizeSession} disabled={processing}
                      className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold px-6 py-2.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-2">
                      {processing ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving...</> : "💾 Save Attendance"}
                    </button>
                  )}
                </div>

                {successMsg && (
                  <div className="bg-emerald-500/20 border border-emerald-500/40 rounded-xl p-4 mb-4 text-emerald-400 font-semibold text-center">
                    {successMsg}
                  </div>
                )}

                <div className="grid grid-cols-4 gap-3 mb-4">
                  {[
                    { label: "Present", value: presentCount, color: "text-emerald-400", border: "border-emerald-500/30" },
                    { label: "Absent", value: totalCount - presentCount, color: "text-red-400", border: "border-red-500/30" },
                    { label: "Total", value: totalCount, color: "text-white", border: "border-white/10" },
                    { label: "Rate", value: `${percentage}%`, color: percentage >= 75 ? "text-emerald-400" : "text-orange-400", border: "border-white/10" },
                  ].map(s => (
                    <div key={s.label} className={`border ${s.border} rounded-xl p-4 text-center`}>
                      <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                      <div className="text-slate-400 text-sm mt-1">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Attendance bar */}
                <div className="bg-white/10 rounded-full h-3 overflow-hidden">
                  <div className={`h-3 rounded-full transition-all ${percentage >= 75 ? "bg-emerald-500" : "bg-orange-500"}`}
                    style={{ width: `${percentage}%` }} />
                </div>

                {/* Export CSV */}
                <div className="flex gap-3 mt-4">
                  <button onClick={() => exportCSV(attendance, session)}
                    className="flex-1 border border-white/20 text-slate-300 font-medium py-2.5 rounded-xl hover:bg-white/10 transition-colors text-sm flex items-center justify-center gap-2">
                    📥 Export CSV
                  </button>
                  <button onClick={() => navigate("/dashboard")}
                    className="flex-1 border border-purple-500/30 text-purple-400 font-medium py-2.5 rounded-xl hover:bg-purple-500/10 transition-colors text-sm flex items-center justify-center gap-2">
                    📊 View Dashboard
                  </button>
                </div>
              </div>

              {/* Per-student results table */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <h3 className="text-white font-bold mb-4">Student-wise Results</h3>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {Object.values(attendance)
                    .sort((a, b) => (b.status === "Present" ? 1 : 0) - (a.status === "Present" ? 1 : 0))
                    .map(a => (
                    <div key={a.student.id} className={`flex items-center gap-3 rounded-xl p-3 border ${a.status === "Present" ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/10"}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${a.status === "Present" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                        {a.status === "Present" ? "✓" : "✗"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium text-sm truncate">{a.student.name}</p>
                        <p className="text-slate-400 text-xs">{a.student.roll_number}</p>
                      </div>
                      {a.status === "Present" && a.confidence > 0 && (
                        <div className="text-xs text-center">
                          <div className="text-emerald-400 font-bold">{a.confidence}%</div>
                          <div className="text-slate-500">conf</div>
                        </div>
                      )}
                      {a.timestamp && (
                        <div className="text-xs text-slate-500">{a.timestamp}</div>
                      )}
                      <button onClick={() => toggleManual(a.student.id)}
                        disabled={sessionSaved}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${a.status === "Present" ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"}`}>
                        {a.status === "Present" ? "Mark Absent" : "Mark Present"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <AttendanceSidebar attendance={attendance} presentCount={presentCount} totalCount={totalCount} percentage={percentage} onToggle={toggleManual} saved={sessionSaved} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SIDEBAR COMPONENT ───────────────────────────────────────────────────────
function AttendanceSidebar({ attendance, presentCount, totalCount, percentage, onToggle, live, processing, saved }) {
  const entries = Object.values(attendance);
  const present = entries.filter(a => a.status === "Present");
  const absent = entries.filter(a => a.status === "Absent");

  return (
    <div className="space-y-4">
      {/* Live percentage ring */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-5 text-center">
        <div className="relative w-28 h-28 mx-auto mb-3">
          <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
            <circle cx="50" cy="50" r="40" fill="none"
              stroke={percentage >= 75 ? "#10b981" : percentage >= 50 ? "#f59e0b" : "#ef4444"}
              strokeWidth="10"
              strokeDasharray={`${percentage * 2.51} 251`}
              strokeLinecap="round"
              style={{ transition: "stroke-dasharray 0.5s ease" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-white text-2xl font-bold">{percentage}%</span>
            <span className="text-slate-400 text-xs">present</span>
          </div>
        </div>
        <p className="text-white font-bold">{presentCount} / {totalCount}</p>
        <p className="text-slate-400 text-sm">students present</p>
        {live && <div className="flex items-center justify-center gap-1 mt-2"><div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" /><span className="text-red-400 text-xs">Live</span></div>}
        {processing && <div className="flex items-center justify-center gap-1 mt-2"><div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" /><span className="text-blue-400 text-xs">Processing...</span></div>}
      </div>

      {/* Present list */}
      {present.length > 0 && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <p className="text-emerald-400 font-bold text-sm mb-3">✅ Present ({present.length})</p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {present.map(a => (
              <div key={a.student.id} className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 text-xs font-bold flex-shrink-0">
                  {a.student.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-medium truncate">{a.student.name}</p>
                  <p className="text-slate-500 text-xs">{a.student.roll_number}</p>
                </div>
                {a.confidence > 0 && <span className="text-emerald-400 text-xs font-bold">{a.confidence}%</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Absent list */}
      {absent.length > 0 && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <p className="text-red-400 font-bold text-sm mb-3">❌ Absent ({absent.length})</p>
          <div className="space-y-1.5 max-h-36 overflow-y-auto">
            {absent.map(a => (
              <div key={a.student.id} className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-red-500/10 flex items-center justify-center text-red-400 text-xs font-bold flex-shrink-0">
                  {a.student.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-slate-400 text-xs truncate">{a.student.name}</p>
                  <p className="text-slate-600 text-xs">{a.student.roll_number}</p>
                </div>
                {!saved && (
                  <button onClick={() => onToggle(a.student.id)}
                    className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-500/20 px-2 py-0.5 rounded-lg transition-colors flex-shrink-0">
                    ✓
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function exportCSV(attendance, session) {
  const rows = [
    ["Name", "Roll Number", "Department", "Status", "Confidence", "Timestamp", "Marked By"],
    ...Object.values(attendance).map(a => [
      a.student.name, a.student.roll_number, a.student.department,
      a.status, a.confidence ? `${a.confidence}%` : "-",
      a.timestamp || "-", a.confidence > 0 ? "Face Recognition" : "Manual"
    ])
  ];
  const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendance_${session?.subject || "session"}_${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
}
