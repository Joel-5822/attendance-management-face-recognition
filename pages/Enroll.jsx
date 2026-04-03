import { useState, useRef, useEffect } from "react";
import { Student } from "@/api/entities";
import { useNavigate } from "react-router-dom";

// face-api.js — best available in-browser face recognition
// Uses SSD MobileNet V1 (detector) + ResNet-34 FaceRecognitionNet (128-dim descriptor)
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
  // SSD MobileNet V1 — more accurate than TinyFaceDetector
  // FaceRecognitionNet — ResNet-34 based, 128-dim, same architecture as FaceNet
  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri(MODELS_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL),
  ]);
  modelsLoaded = true;
}

// Compute mean descriptor from multiple samples
function averageDescriptors(descriptorArrays) {
  const len = descriptorArrays[0].length;
  return descriptorArrays[0].map((_, i) =>
    descriptorArrays.reduce((sum, d) => sum + d[i], 0) / descriptorArrays.length
  );
}

// L2-normalize a descriptor vector (makes matching more stable)
function l2Normalize(descriptor) {
  const norm = Math.sqrt(descriptor.reduce((sum, v) => sum + v * v, 0));
  return descriptor.map(v => v / (norm + 1e-10));
}

export default function Enroll() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const faceapiRef = useRef(null);
  const intervalRef = useRef(null);
  const autoCaptureRef = useRef(null);

  // enrollMode: "webcam" | "upload"
  const [enrollMode, setEnrollMode] = useState("webcam");
  const [step, setStep] = useState("form"); // form | camera | uploading | processing | done
  const [loading, setLoading] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [capturedDescriptor, setCapturedDescriptor] = useState(null);
  const [capturedImageUrl, setCapturedImageUrl] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [students, setStudents] = useState([]);
  const [error, setError] = useState("");
  const [detectionStatus, setDetectionStatus] = useState("Initializing...");
  const [captureCount, setCaptureCount] = useState(0);
  const [descriptors, setDescriptors] = useState([]);
  const [autoCapture, setAutoCapture] = useState(false);
  const TARGET_SAMPLES = 20; // 20 samples for webcam

  // Photo upload state
  const [uploadedPhotos, setUploadedPhotos] = useState([]); // [{file, url, status, descriptor, error}]
  const [processingIdx, setProcessingIdx] = useState(-1);
  const [processedCount, setProcessedCount] = useState(0);
  const [successCount, setSuccessCount] = useState(0);
  const MIN_PHOTOS = 15;
  const MAX_PHOTOS = 25;

  const [form, setForm] = useState({
    name: "", roll_number: "", department: "Computer Science", semester: "3rd"
  });

  useEffect(() => { loadStudents(); }, []);

  const loadStudents = async () => {
    try { const data = await Student.list(); setStudents(data); } catch (e) {}
  };

  // ─── WEBCAM ENROLLMENT ───────────────────────────────────────────
  const initCamera = async () => {
    if (!form.name || !form.roll_number) { setError("Name and Roll Number are required"); return; }
    setLoading(true);
    setError("");
    try {
      const faceapi = await loadFaceApi();
      faceapiRef.current = faceapi;
      setDetectionStatus("Loading AI models (SSD MobileNet V1 + ResNet-34)...");
      await loadModels(faceapi);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStep("camera");
      setDetectionStatus("Position your face — look straight, then turn slightly left/right");
      startDetectionLoop();
    } catch (e) {
      setError("Camera access denied or models failed to load. Please allow camera and try again.");
    }
    setLoading(false);
  };

  const startDetectionLoop = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(async () => {
      if (!videoRef.current || !faceapiRef.current || !canvasRef.current) return;
      const faceapi = faceapiRef.current;
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
        faceapi.draw.drawDetections(canvas, resized);
        faceapi.draw.drawFaceLandmarks(canvas, resized);

        if (detections.length === 1) {
          setFaceDetected(true);
        } else {
          setFaceDetected(false);
        }
      } catch (e) {}
    }, 250);
  };

  // Auto-capture every 800ms when face is detected
  useEffect(() => {
    if (autoCapture && faceDetected && step === "camera") {
      autoCaptureRef.current = setTimeout(() => captureSample(true), 800);
    }
    return () => clearTimeout(autoCaptureRef.current);
  }, [autoCapture, faceDetected, captureCount, step]);

  const captureSample = async (isAuto = false) => {
    if (!videoRef.current || !faceapiRef.current) return;
    const faceapi = faceapiRef.current;
    const video = videoRef.current;

    const detection = await faceapi
      .detectSingleFace(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) {
      if (!isAuto) setError("No face detected. Try again.");
      return;
    }
    setError("");

    const desc = Array.from(detection.descriptor);
    setDescriptors(prev => {
      const updated = [...prev, desc];
      const newCount = updated.length;
      setCaptureCount(newCount);

      const hints = [
        "Look straight at camera",
        "Tilt slightly left",
        "Tilt slightly right",
        "Look up slightly",
        "Look down slightly",
        "Move closer",
        "Move further",
        "Natural expression",
        "Slight smile",
        "Turn head left",
        "Turn head right",
        "Look straight again",
        "Different lighting",
        "Relax your face",
        "Look center",
        "Slight left tilt",
        "Slight right tilt",
        "Eyes wide open",
        "Normal blink",
        "Final sample ✓"
      ];
      const hint = hints[Math.min(newCount - 1, hints.length - 1)];
      setDetectionStatus(`📸 ${newCount}/${TARGET_SAMPLES} — ${hint}`);

      if (newCount >= TARGET_SAMPLES) {
        const avgDesc = averageDescriptors(updated);
        const normalizedDesc = l2Normalize(avgDesc);
        // Capture best-quality profile image
        const captureCanvas = document.createElement("canvas");
        captureCanvas.width = video.videoWidth;
        captureCanvas.height = video.videoHeight;
        captureCanvas.getContext("2d").drawImage(video, 0, 0);
        const imageUrl = captureCanvas.toDataURL("image/jpeg", 0.9);
        setCapturedDescriptor(normalizedDesc);
        setCapturedImageUrl(imageUrl);
        setAutoCapture(false);
        setStep("done");
        stopCamera();
      }
      return updated;
    });
  };

  const stopCamera = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    clearTimeout(autoCaptureRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  };

  // ─── PHOTO UPLOAD ENROLLMENT ─────────────────────────────────────
  const handlePhotoUpload = (e) => {
    const files = Array.from(e.target.files);
    if (files.length < MIN_PHOTOS) {
      setError(`Please select at least ${MIN_PHOTOS} photos (you selected ${files.length})`);
      return;
    }
    if (files.length > MAX_PHOTOS) {
      setError(`Maximum ${MAX_PHOTOS} photos allowed (you selected ${files.length})`);
      return;
    }
    setError("");
    const photos = files.map(file => ({
      file,
      url: URL.createObjectURL(file),
      status: "pending", // pending | processing | success | failed
      descriptor: null,
      errorMsg: null
    }));
    setUploadedPhotos(photos);
    setStep("uploading");
  };

  const processPhotos = async () => {
    if (uploadedPhotos.length < MIN_PHOTOS) return;
    if (!form.name || !form.roll_number) { setError("Name and Roll Number are required"); return; }

    setLoading(true);
    setError("");
    setStep("processing");
    setProcessingIdx(0);
    setProcessedCount(0);
    setSuccessCount(0);

    let faceapi;
    try {
      faceapi = await loadFaceApi();
      faceapiRef.current = faceapi;
      await loadModels(faceapi);
    } catch (e) {
      setError("Failed to load AI models. Please refresh and try again.");
      setLoading(false);
      setStep("uploading");
      return;
    }

    const successDescriptors = [];
    let profileImage = null;
    const updatedPhotos = [...uploadedPhotos];

    for (let i = 0; i < uploadedPhotos.length; i++) {
      setProcessingIdx(i);
      updatedPhotos[i] = { ...updatedPhotos[i], status: "processing" };
      setUploadedPhotos([...updatedPhotos]);

      try {
        const img = await createImageBitmap(uploadedPhotos[i].file);
        const offscreen = document.createElement("canvas");
        offscreen.width = img.width;
        offscreen.height = img.height;
        offscreen.getContext("2d").drawImage(img, 0, 0);

        const detection = await faceapi
          .detectSingleFace(offscreen, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (detection) {
          const desc = Array.from(detection.descriptor);
          successDescriptors.push(desc);
          updatedPhotos[i] = { ...updatedPhotos[i], status: "success", descriptor: desc };
          if (!profileImage) profileImage = uploadedPhotos[i].url;
          setSuccessCount(s => s + 1);
        } else {
          updatedPhotos[i] = { ...updatedPhotos[i], status: "failed", errorMsg: "No face detected" };
        }
      } catch (e) {
        updatedPhotos[i] = { ...updatedPhotos[i], status: "failed", errorMsg: "Processing error" };
      }

      setProcessedCount(i + 1);
      setUploadedPhotos([...updatedPhotos]);
      // Small delay to allow UI to update
      await new Promise(r => setTimeout(r, 30));
    }

    if (successDescriptors.length < 5) {
      setError(`Only ${successDescriptors.length} photos had detectable faces. Please upload clearer face photos.`);
      setStep("uploading");
      setLoading(false);
      return;
    }

    // Average all valid descriptors and L2-normalize
    const avgDesc = averageDescriptors(successDescriptors);
    const normalizedDesc = l2Normalize(avgDesc);
    setCapturedDescriptor(normalizedDesc);
    setCapturedImageUrl(profileImage);
    setStep("done");
    setLoading(false);
  };

  // ─── SAVE STUDENT ─────────────────────────────────────────────────
  const saveStudent = async () => {
    if (!capturedDescriptor) return;
    setSaving(true);
    setError("");
    try {
      const sampleCount = enrollMode === "upload" ? successCount : TARGET_SAMPLES;
      await Student.create({
        name: form.name,
        roll_number: form.roll_number,
        department: form.department,
        semester: form.semester,
        face_descriptor: JSON.stringify(capturedDescriptor),
        face_image_url: capturedImageUrl,
        enrolled: true,
        student_id: `${form.department.slice(0, 3).toUpperCase()}-${form.roll_number}`
      });
      setSaved(true);
      await loadStudents();
      setTimeout(() => {
        setStep("form");
        setSaved(false);
        setCapturedDescriptor(null);
        setCapturedImageUrl(null);
        setCaptureCount(0);
        setDescriptors([]);
        setUploadedPhotos([]);
        setProcessedCount(0);
        setSuccessCount(0);
        setForm({ name: "", roll_number: "", department: "Computer Science", semester: "3rd" });
      }, 2500);
    } catch (e) {
      setError("Failed to save student. Try again.");
    }
    setSaving(false);
  };

  useEffect(() => { return () => stopCamera(); }, []);

  const deleteStudent = async (id) => {
    if (!confirm("Delete this student and their face data?")) return;
    await Student.delete(id);
    loadStudents();
  };

  const resetToForm = () => {
    stopCamera();
    setStep("form");
    setCaptureCount(0);
    setDescriptors([]);
    setCapturedDescriptor(null);
    setCapturedImageUrl(null);
    setUploadedPhotos([]);
    setProcessedCount(0);
    setSuccessCount(0);
    setError("");
    setAutoCapture(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-emerald-950 to-slate-900 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => navigate("/")} className="text-slate-400 hover:text-white transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-3xl font-bold text-white">Student Enrollment</h1>
            <p className="text-emerald-400 text-sm">SSD MobileNet V1 detector · ResNet-34 FaceRecognitionNet · L2-normalized 128-dim descriptors</p>
          </div>
          <div className="ml-auto bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-2">
            <span className="text-emerald-400 font-bold text-xl">{students.length}</span>
            <span className="text-slate-400 text-sm ml-2">enrolled</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left panel */}
          <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6">

            {/* ── STEP: FORM ─────────────────────────────── */}
            {step === "form" && (
              <>
                <h2 className="text-white font-bold text-xl mb-5 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-emerald-500 text-white text-sm flex items-center justify-center font-bold">1</span>
                  Student Details
                </h2>

                {/* Enrollment mode toggle */}
                <div className="grid grid-cols-2 gap-3 mb-5">
                  {[
                    { id: "webcam", label: "Live Webcam", icon: "🎥", desc: "20 auto-captured samples" },
                    { id: "upload", label: "Upload Photos", icon: "📷", desc: "15–25 photos from device" }
                  ].map(opt => (
                    <button key={opt.id} onClick={() => setEnrollMode(opt.id)}
                      className={`p-4 rounded-xl border text-left transition-all ${enrollMode === opt.id ? "border-emerald-500 bg-emerald-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>
                      <div className="text-2xl mb-1">{opt.icon}</div>
                      <div className="text-white font-semibold text-sm">{opt.label}</div>
                      <div className="text-slate-400 text-xs mt-0.5">{opt.desc}</div>
                    </button>
                  ))}
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-slate-400 text-sm mb-1 block">Full Name *</label>
                    <input
                      className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                      placeholder="e.g., Arunima S"
                      value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 text-sm mb-1 block">Roll Number *</label>
                    <input
                      className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                      placeholder="e.g., SCT23CS019"
                      value={form.roll_number}
                      onChange={e => setForm({ ...form, roll_number: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-slate-400 text-sm mb-1 block">Department</label>
                      <select className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                        value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}>
                        {["Computer Science", "Electronics", "Mechanical", "Civil", "IT"].map(d => (
                          <option key={d} value={d} className="bg-slate-800">{d}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-slate-400 text-sm mb-1 block">Semester</label>
                      <select className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                        value={form.semester} onChange={e => setForm({ ...form, semester: e.target.value })}>
                        {["1st","2nd","3rd","4th","5th","6th","7th","8th"].map(s => (
                          <option key={s} value={s} className="bg-slate-800">{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {error && <p className="text-red-400 text-sm bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}

                  {enrollMode === "webcam" ? (
                    <button onClick={initCamera} disabled={loading}
                      className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold py-4 rounded-xl hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                      {loading ? (
                        <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Loading Models (SSD+ResNet)...</>
                      ) : (
                        <>🎥 Open Camera — 20 Sample Capture</>
                      )}
                    </button>
                  ) : (
                    <div>
                      <label className={`w-full flex flex-col items-center gap-3 cursor-pointer border-2 border-dashed rounded-xl py-8 px-4 text-center transition-colors ${!form.name || !form.roll_number ? "border-white/10 opacity-50 cursor-not-allowed" : "border-white/20 hover:border-emerald-500/50"}`}
                        onClick={() => { if (!form.name || !form.roll_number) { setError("Fill in Name and Roll Number first"); } }}>
                        <input type="file" accept="image/*" multiple className="hidden"
                          disabled={!form.name || !form.roll_number}
                          onChange={handlePhotoUpload} />
                        <span className="text-4xl">📷</span>
                        <span className="text-white font-bold">Select 15–25 Face Photos</span>
                        <span className="text-slate-400 text-sm">JPG, PNG, HEIC — different angles, lighting, expressions</span>
                        <span className="bg-emerald-500/20 text-emerald-400 text-xs px-3 py-1 rounded-full font-medium">More photos = better accuracy</span>
                      </label>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ── STEP: WEBCAM CAMERA ─────────────────────── */}
            {step === "camera" && (
              <>
                <h2 className="text-white font-bold text-xl mb-3 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-emerald-500 text-white text-sm flex items-center justify-center font-bold">2</span>
                  Face Capture — {form.name}
                </h2>
                <div className="relative bg-black rounded-xl overflow-hidden mb-3" style={{ aspectRatio: "4/3" }}>
                  <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                  <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
                  {/* Face guide oval */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className={`w-44 h-52 border-4 rounded-full transition-all duration-300 ${faceDetected ? "border-emerald-400 shadow-[0_0_30px_rgba(52,211,153,0.4)]" : "border-white/20"}`} />
                  </div>
                  {/* Status bar */}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm px-4 py-3">
                    <p className="text-white text-xs text-center font-medium">{detectionStatus}</p>
                    <div className="flex gap-1 justify-center mt-2 flex-wrap">
                      {Array.from({ length: TARGET_SAMPLES }).map((_, n) => (
                        <div key={n} className={`w-4 h-1.5 rounded-full transition-colors ${n < captureCount ? "bg-emerald-400" : "bg-white/15"}`} />
                      ))}
                    </div>
                  </div>
                  {/* Auto-capture indicator */}
                  {autoCapture && faceDetected && (
                    <div className="absolute top-3 right-3 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full animate-pulse">
                      ● AUTO
                    </div>
                  )}
                </div>

                <div className="flex gap-2 mb-3">
                  <button onClick={() => captureSample(false)} disabled={!faceDetected}
                    className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold py-3 rounded-xl hover:opacity-90 transition-all disabled:opacity-40 text-sm">
                    📸 Capture Sample ({captureCount}/{TARGET_SAMPLES})
                  </button>
                  <button
                    onClick={() => setAutoCapture(a => !a)}
                    className={`px-4 py-3 rounded-xl font-bold text-sm transition-all ${autoCapture ? "bg-red-500/20 text-red-400 border border-red-500/40" : "bg-white/10 text-slate-400 hover:bg-white/20"}`}>
                    {autoCapture ? "⏹ Stop" : "⚡ Auto"}
                  </button>
                  <button onClick={resetToForm} className="px-4 py-3 bg-white/10 text-slate-400 rounded-xl hover:bg-white/20 transition-colors text-sm">
                    ✕
                  </button>
                </div>
                <p className="text-slate-500 text-xs text-center">
                  💡 Tip: Enable <strong className="text-slate-400">Auto</strong> to capture automatically when face is in frame
                </p>
              </>
            )}

            {/* ── STEP: PHOTO UPLOAD PREVIEW ───────────────── */}
            {step === "uploading" && (
              <>
                <h2 className="text-white font-bold text-xl mb-4 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-emerald-500 text-white text-sm flex items-center justify-center font-bold">2</span>
                  Review Photos — {form.name}
                </h2>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-slate-400 text-sm">{uploadedPhotos.length} photos selected</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${uploadedPhotos.length >= MIN_PHOTOS && uploadedPhotos.length <= MAX_PHOTOS ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                    {uploadedPhotos.length >= MIN_PHOTOS && uploadedPhotos.length <= MAX_PHOTOS ? "✓ Good count" : `Need ${MIN_PHOTOS}–${MAX_PHOTOS}`}
                  </span>
                </div>
                {/* Photo grid */}
                <div className="grid grid-cols-5 gap-2 max-h-56 overflow-y-auto mb-4 p-1">
                  {uploadedPhotos.map((p, i) => (
                    <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-white/5">
                      <img src={p.url} className="w-full h-full object-cover" alt={`photo ${i+1}`} />
                      <div className="absolute inset-0 bg-black/20" />
                      <span className="absolute bottom-0 left-0 right-0 text-center text-white text-xs py-0.5 bg-black/40">{i+1}</span>
                    </div>
                  ))}
                </div>
                {error && <p className="text-red-400 text-sm bg-red-500/10 rounded-lg px-3 py-2 mb-3">{error}</p>}
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 mb-4">
                  <p className="text-blue-400 text-xs leading-relaxed">
                    <strong>Best results:</strong> Vary angles (front, slightly left, slightly right), expressions (neutral, smiling), and lighting conditions across photos. Avoid blurry or far-away shots.
                  </p>
                </div>
                <div className="flex gap-3">
                  <button onClick={processPhotos} disabled={loading || uploadedPhotos.length < MIN_PHOTOS}
                    className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold py-3 rounded-xl hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    {loading ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Loading Models...</> : "🔍 Process & Extract Faces"}
                  </button>
                  <button onClick={() => { setStep("form"); setUploadedPhotos([]); setError(""); }}
                    className="px-4 bg-white/10 text-slate-400 rounded-xl hover:bg-white/20 transition-colors">
                    Back
                  </button>
                </div>
              </>
            )}

            {/* ── STEP: PROCESSING PHOTOS ──────────────────── */}
            {step === "processing" && (
              <>
                <h2 className="text-white font-bold text-xl mb-6 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-blue-500 text-white text-sm flex items-center justify-center">
                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  </span>
                  Extracting Face Embeddings
                </h2>

                {/* Progress bar */}
                <div className="mb-4">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-slate-400">Processing photos</span>
                    <span className="text-white font-bold">{processedCount}/{uploadedPhotos.length}</span>
                  </div>
                  <div className="bg-white/10 rounded-full h-3">
                    <div className="bg-gradient-to-r from-emerald-500 to-teal-600 h-3 rounded-full transition-all duration-300"
                      style={{ width: `${(processedCount / uploadedPhotos.length) * 100}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 mt-1">
                    <span>✅ {successCount} faces extracted</span>
                    <span>{processedCount - successCount} skipped</span>
                  </div>
                </div>

                {/* Photo processing grid */}
                <div className="grid grid-cols-5 gap-2 max-h-64 overflow-y-auto p-1">
                  {uploadedPhotos.map((p, i) => (
                    <div key={i} className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                      p.status === "success" ? "border-emerald-500" :
                      p.status === "failed" ? "border-red-500/50" :
                      p.status === "processing" ? "border-blue-500 animate-pulse" :
                      "border-white/10"
                    }`}>
                      <img src={p.url} className="w-full h-full object-cover" alt="" />
                      <div className={`absolute inset-0 flex items-center justify-center ${
                        p.status === "success" ? "bg-emerald-500/20" :
                        p.status === "failed" ? "bg-red-500/30" :
                        p.status === "processing" ? "bg-blue-500/20" :
                        "bg-black/30"
                      }`}>
                        {p.status === "success" && <span className="text-white text-lg">✓</span>}
                        {p.status === "failed" && <span className="text-red-300 text-lg">✗</span>}
                        {p.status === "processing" && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                      </div>
                    </div>
                  ))}
                </div>

                <p className="text-slate-500 text-xs text-center mt-4">
                  SSD MobileNet V1 + ResNet-34 FaceRecognitionNet running in browser...
                </p>
              </>
            )}

            {/* ── STEP: DONE / CONFIRM ─────────────────────── */}
            {step === "done" && (
              <>
                <h2 className="text-white font-bold text-xl mb-5 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-emerald-500 text-white text-sm flex items-center justify-center font-bold">3</span>
                  Confirm & Save
                </h2>

                {capturedImageUrl && (
                  <div className="relative mb-5">
                    <img src={capturedImageUrl} className="w-full rounded-xl object-cover max-h-52" alt="Profile" />
                    <div className="absolute top-3 right-3 bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg">
                      {enrollMode === "upload" ? `✓ ${successCount} photos processed` : `✓ ${TARGET_SAMPLES} samples averaged`}
                    </div>
                  </div>
                )}

                <div className="bg-white/5 rounded-xl p-4 mb-4 space-y-2.5">
                  {[
                    ["Name", form.name],
                    ["Roll No", form.roll_number],
                    ["Department", form.department],
                    ["Semester", form.semester],
                    ["Model", "ResNet-34 FaceRecognitionNet"],
                    ["Descriptor", "128-dim · L2-normalized · averaged"],
                    ["Method", enrollMode === "upload" ? `${successCount} photos → 1 descriptor` : `${TARGET_SAMPLES} webcam samples → 1 descriptor`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between items-start gap-2">
                      <span className="text-slate-400 text-sm flex-shrink-0">{k}</span>
                      <span className="text-white text-sm font-medium text-right">{v}</span>
                    </div>
                  ))}
                </div>

                {error && <p className="text-red-400 text-sm mb-3 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
                {saved && (
                  <div className="bg-emerald-500/20 border border-emerald-500/40 rounded-xl p-3 text-center text-emerald-400 font-bold mb-3 flex items-center justify-center gap-2">
                    ✅ Student enrolled successfully!
                  </div>
                )}

                <div className="flex gap-3">
                  <button onClick={saveStudent} disabled={saving || saved}
                    className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold py-3.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    {saving ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving...</> : "💾 Save Student"}
                  </button>
                  <button onClick={resetToForm}
                    className="px-5 bg-white/10 text-slate-400 rounded-xl hover:bg-white/20 transition-colors text-sm font-medium">
                    Redo
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Right: enrolled list */}
          <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-bold text-xl">Enrolled Students</h2>
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-1 text-emerald-400 text-sm font-bold">
                {students.length} registered
              </div>
            </div>

            {/* Model info banner */}
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 mb-4">
              <p className="text-blue-400 text-xs font-medium">🧠 Active Models</p>
              <p className="text-slate-300 text-xs mt-1">
                <strong>Detector:</strong> SSD MobileNet V1 (higher accuracy than TinyFaceDetector)<br/>
                <strong>Embeddings:</strong> ResNet-34 FaceRecognitionNet — 128-dim, L2-normalized, averaged across all samples
              </p>
            </div>

            {students.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <svg className="w-16 h-16 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <p className="font-medium">No students enrolled yet</p>
                <p className="text-sm mt-1">Use webcam or upload photos to begin</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                {students.map(s => (
                  <div key={s.id} className="flex items-center gap-3 bg-white/5 rounded-xl p-3 group hover:bg-white/10 transition-colors">
                    {s.face_image_url ? (
                      <img src={s.face_image_url} className="w-12 h-12 rounded-full object-cover border-2 border-emerald-500/40 flex-shrink-0" alt={s.name} />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-lg flex-shrink-0">
                        {s.name?.charAt(0)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold truncate">{s.name}</p>
                      <p className="text-slate-400 text-xs">{s.roll_number} · {s.department}</p>
                      <p className="text-emerald-400 text-xs">128-dim ResNet embedding ✓</p>
                    </div>
                    <button onClick={() => deleteStudent(s.id)}
                      className="text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
