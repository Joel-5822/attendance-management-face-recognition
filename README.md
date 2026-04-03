# 🎓 FaceAttend — Attendance Management System Using Face Recognition

[![Live Demo](https://img.shields.io/badge/Live%20Demo-untitled--app--70f167e2.base44.app-blue?style=for-the-badge)](https://untitled-app-70f167e2.base44.app)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![Made With](https://img.shields.io/badge/Made%20With-React%20%2B%20face--api.js-blueviolet?style=for-the-badge)

> **Mini Project — Department of Computer Science**
> Real-time, contactless attendance system that automatically identifies registered students from live or recorded classroom video using deep learning face recognition — running entirely in the browser with no server-side inference.

---

## 👥 Team

| Name | Roll Number |
|------|------------|
| Arunima S | SCT23CS019 |
| Gokul AB | SCT23CS031 |
| Joel Kurian | SCT23CS035 |

**Guide:** Anu Krishnan B

---

## 🧠 Problem Statement

> *"Design and implement a real-time, contactless attendance system that accurately identifies registered individuals from live video."*

Traditional attendance systems are time-consuming, error-prone, and vulnerable to proxy attendance. This system replaces manual roll calls with automated face recognition from a single classroom video feed.

---

## ✨ Features

### Phase 1 — Student Enrollment
- **Live Webcam Capture** — 20 guided samples per student with pose hints (left, right, tilt, etc.)
- **Batch Photo Upload** — Upload 15–25 photos for offline enrollment; supports varied angles and lighting
- All samples averaged into a single **128-dimensional L2-normalized face descriptor**
- Stores roll number, department, semester, face image, and face embedding in a cloud database

### Phase 2 — Attendance Marking
- **Live Webcam Mode** — Real-time frame-by-frame detection; marks Present as soon as a face is matched with >60% confidence
- **Video Upload Mode** — Process a pre-recorded classroom video; samples every 1 second
- Displays bounding boxes + name labels + confidence % on the video canvas
- Manual override toggle for each student before saving

### Phase 3 — Reports & Analytics
- Session-wise attendance register with confidence scores, timestamps, and detection method
- Per-student attendance percentage with 75% threshold warning
- CSV export for both session-level and student-level reports
- Search and filter across all sessions

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    ENROLLMENT PHASE                      │
│                                                         │
│  Webcam / Photos → SSD MobileNet V1 (Face Detection)   │
│       → Face Landmark 68-point Detection               │
│       → ResNet-34 FaceRecognitionNet (128-dim embed.)  │
│       → L2-Normalize → Average N samples → Store DB   │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│                   ATTENDANCE PHASE                       │
│                                                         │
│  Live Video / Uploaded Video                           │
│       → SSD MobileNet V1 (detect all faces in frame)  │
│       → ResNet-34 (128-dim descriptor per face)        │
│       → FaceMatcher KNN (Euclidean distance ≤ 0.5)    │
│       → Confidence = (1 - distance) × 100             │
│       → if confidence > 60% → Mark Present            │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│                  REPORTS & ANALYTICS                     │
│                                                         │
│  Session records → Dashboard → CSV Export              │
│  Student-wise attendance % → 75% threshold alert       │
└─────────────────────────────────────────────────────────┘
```

---

## 🔬 Models & Algorithms

| Component | Model | Details |
|-----------|-------|---------|
| **Face Detection** | SSD MobileNet V1 | Single Shot MultiBox Detector — detects multiple faces simultaneously, more accurate than lightweight detectors |
| **Face Landmarks** | 68-point Landmark Net | Locates key facial points for alignment before descriptor extraction |
| **Face Recognition** | ResNet-34 FaceRecognitionNet | Generates 128-dimensional face embedding vectors — same architecture as the original FaceNet paper |
| **Matching** | KNN / FaceMatcher | Euclidean distance between query descriptor and all enrolled descriptors. Threshold: 0.5 |
| **Library** | face-api.js v0.22.2 | Runs entirely in-browser via WebGL — no server inference needed |

### Why These Models?
- **SSD MobileNet V1** over TinyFaceDetector: Higher accuracy, handles varied poses and distances better — critical for classroom setups where students are far from the camera
- **ResNet-34** embeddings: Produces highly discriminative 128-dim vectors; even small differences between faces are captured
- **L2 Normalization**: Ensures all descriptors lie on a unit hypersphere — makes Euclidean distance equivalent to cosine similarity, improving matching consistency
- **Averaging N samples**: Reduces noise from individual captures; a descriptor computed from 20 samples is far more robust than one from a single photo

---

## 🗄️ Data Model

### `Student`
```json
{
  "name": "string",
  "roll_number": "string",
  "department": "string",
  "semester": "string",
  "face_descriptor": "string (JSON array — 128 floats, L2-normalized)",
  "face_image_url": "string (base64 JPEG thumbnail)",
  "enrolled": "boolean",
  "student_id": "string"
}
```

### `AttendanceSession`
```json
{
  "session_name": "string",
  "subject": "string",
  "department": "string",
  "semester": "string",
  "date": "string (YYYY-MM-DD)",
  "time_slot": "string",
  "status": "Active | Completed | Cancelled",
  "total_students": "number",
  "present_count": "number",
  "video_processed": "boolean"
}
```

### `AttendanceRecord`
```json
{
  "session_id": "string",
  "student_id": "string",
  "student_name": "string",
  "roll_number": "string",
  "status": "Present | Absent | Late",
  "confidence": "number (0–100)",
  "timestamp": "string",
  "marked_by": "Face Recognition | Manual"
}
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + Tailwind CSS |
| **Face Recognition** | face-api.js (SSD MobileNet V1 + ResNet-34) |
| **Routing** | React Router v6 |
| **Database** | Base44 (managed cloud database) |
| **Hosting** | Base44 (edge-deployed mini app) |
| **Video Input** | WebRTC (getUserMedia) + HTML5 Video |
| **Canvas Rendering** | HTML5 Canvas API |

---

## 📱 Pages

| Route | Description |
|-------|-------------|
| `/` | Home — landing page with navigation to all phases |
| `/enroll` | Student enrollment — webcam capture or photo upload |
| `/attendance` | Mark attendance — live webcam or video upload |
| `/dashboard` | Reports, session history, student analytics, CSV export |

---

## 🚀 Running the Project

This is a hosted web app — no local setup needed.

**Live URL:** https://untitled-app-70f167e2.base44.app

### Local Development (optional)

```bash
# Clone the repo
git clone https://github.com/Joel-5822/attendance-management-face-recognition.git
cd attendance-management-face-recognition

# Install dependencies
npm install

# Start dev server
npm run dev
```

> Note: The app uses Base44's managed backend for database. For full local functionality, you'd need to set up a Base44 project or swap in your own backend.

---

## 📋 Usage Guide

### Step 1: Enroll Students
1. Go to **Enroll Students** (Phase 1)
2. Fill in student details (name, roll number, department, semester)
3. Choose enrollment mode:
   - **Webcam**: Click "Open Camera" → position face in oval guide → click "Capture Sample" 20 times (or use Auto-capture)
   - **Upload Photos**: Select 15–25 clear face photos → click "Process & Extract Faces"
4. Review the extracted 128-dim embedding → click "Save Student"

### Step 2: Mark Attendance
1. Go to **Mark Attendance** (Phase 2)
2. Enter subject, department, semester, and time slot
3. Choose video input:
   - **Live Webcam**: Point camera at classroom → faces are detected in real-time → students marked Present automatically
   - **Upload Video**: Upload an MP4/MOV recording → system processes every second of the video
4. Review the attendance register → use manual override if needed → click "Save Attendance"

### Step 3: View Reports
1. Go to **Reports & Analytics**
2. Browse session history or filter by subject
3. Click any session to see individual records with confidence scores
4. Switch to "By Student" to see per-student attendance percentages
5. Export any view as CSV

---

## 🔒 Privacy & Security

- **On-device processing**: All face detection and recognition runs in the browser via WebGL — no face images are sent to any server
- **Descriptor-only storage**: Only the 128-float numerical descriptor is stored, not raw face images (thumbnail only for display)
- **No cloud ML API**: No external face recognition service is used — fully self-contained

---

## 🔮 Future Improvements

- [ ] Anti-spoofing / liveness detection (prevent photo attacks)
- [ ] Python backend with InsightFace / ArcFace for higher accuracy
- [ ] Multiple enrollment images stored per student (multi-descriptor matching)
- [ ] Automatic email reports to faculty
- [ ] Mobile app (React Native) with camera integration
- [ ] Integration with college ERP / LMS systems
- [ ] Low-light image enhancement pre-processing

---

## 📚 References

1. Schroff, F., Kalenichenko, D., & Philbin, J. (2015). *FaceNet: A Unified Embedding for Face Recognition and Clustering*. CVPR.
2. Liu, W., et al. (2016). *SSD: Single Shot MultiBox Detector*. ECCV.
3. Vincent, J. (2020). *face-api.js* — JavaScript Face Recognition library. [GitHub](https://github.com/justadudewhohacks/face-api.js)
4. Howard, A. G., et al. (2017). *MobileNets: Efficient Convolutional Neural Networks for Mobile Vision Applications*. arXiv.

---

## 📄 License

MIT License — free to use for educational purposes.

---

<p align="center">Built with ❤️ by Arunima S, Gokul AB & Joel Kurian · CS Mini Project 2024</p>
