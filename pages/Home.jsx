import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex flex-col items-center justify-center p-6">
      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <div className="relative z-10 text-center mb-10">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-blue-500/30">
            <svg className="w-9 h-9 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-4xl font-bold text-white tracking-tight">FaceAttend</h1>
            <p className="text-blue-400 text-sm font-medium tracking-widest uppercase">AI-Powered Classroom Attendance</p>
          </div>
        </div>
        <p className="text-slate-400 text-lg max-w-lg mx-auto mt-3">
          Upload a single classroom video — the system detects every student including those at the backmost bench and marks attendance automatically.
        </p>
      </div>

      {/* Main cards */}
      <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-5 max-w-4xl w-full mb-8">
        {[
          {
            icon: "👤",
            title: "Enroll Students",
            desc: "Register each student's face once — via 20-sample webcam capture or 15–25 photo upload. Creates a robust 128-dim ResNet-34 embedding.",
            color: "from-emerald-500 to-teal-600",
            shadow: "shadow-emerald-500/20",
            route: "/enroll",
            badge: "Phase 1 · One-time Setup"
          },
          {
            icon: "🎬",
            title: "Mark Attendance",
            desc: "Upload a classroom video recorded from the front. The system samples every frame, upscales for back-bench faces, and marks attendance automatically.",
            color: "from-blue-500 to-indigo-600",
            shadow: "shadow-blue-500/20",
            route: "/attendance",
            badge: "Phase 2 · Every Class"
          },
          {
            icon: "📊",
            title: "Reports",
            desc: "Session-wise attendance register, per-student percentage, CSV export, and 75% threshold alerts.",
            color: "from-purple-500 to-pink-600",
            shadow: "shadow-purple-500/20",
            route: "/dashboard",
            badge: "Analytics"
          }
        ].map((card) => (
          <button key={card.route} onClick={() => navigate(card.route)}
            className={`group bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 text-left hover:bg-white/10 transition-all duration-300 hover:scale-105 hover:border-white/20 shadow-xl ${card.shadow}`}>
            <div className="text-4xl mb-4">{card.icon}</div>
            <span className={`text-xs font-bold uppercase tracking-widest bg-gradient-to-r ${card.color} bg-clip-text text-transparent`}>{card.badge}</span>
            <h2 className="text-white text-xl font-bold mt-1 mb-2">{card.title}</h2>
            <p className="text-slate-400 text-sm leading-relaxed">{card.desc}</p>
            <div className="mt-4 flex items-center gap-2 text-slate-500 group-hover:text-slate-300 transition-colors">
              <span className="text-sm">Open</span>
              <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        ))}
      </div>

      {/* Tech specs strip */}
      <div className="relative z-10 bg-white/5 border border-white/10 rounded-2xl px-6 py-4 max-w-4xl w-full">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center text-sm">
          {[
            { label: "Detector", value: "SSD MobileNet V1", sub: "minConf: 0.3" },
            { label: "Recognition", value: "ResNet-34 FaceNet", sub: "128-dim L2-normalized" },
            { label: "Back-bench mode", value: "2× upscale + CLAHE", sub: "per-frame enhancement" },
            { label: "Processing", value: "3 frames/sec", sub: "in-browser, no cloud" },
          ].map(item => (
            <div key={item.label}>
              <div className="text-slate-500 text-xs uppercase tracking-wider">{item.label}</div>
              <div className="text-slate-200 font-semibold mt-0.5">{item.value}</div>
              <div className="text-slate-500 text-xs">{item.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
