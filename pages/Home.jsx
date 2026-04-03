import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex flex-col items-center justify-center p-6">
      {/* Animated background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <div className="relative z-10 text-center mb-12">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-blue-500/30">
            <svg className="w-9 h-9 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-4xl font-bold text-white tracking-tight">FaceAttend</h1>
            <p className="text-blue-400 text-sm font-medium tracking-widest uppercase">AI-Powered Attendance System</p>
          </div>
        </div>
        <p className="text-slate-400 text-lg max-w-md mx-auto mt-4">
          Real-time contactless attendance using deep learning face recognition from classroom video
        </p>
      </div>

      <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl w-full">
        {[
          {
            icon: (
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
            ),
            title: "Enroll Students",
            desc: "Register students with live webcam face capture — builds a face descriptor database using FaceNet embeddings",
            color: "from-emerald-500 to-teal-600",
            shadow: "shadow-emerald-500/20",
            route: "/enroll",
            badge: "Phase 1"
          },
          {
            icon: (
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.876V15.124a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
            ),
            title: "Mark Attendance",
            desc: "Upload or stream classroom video — system detects all faces simultaneously and marks attendance automatically",
            color: "from-blue-500 to-indigo-600",
            shadow: "shadow-blue-500/20",
            route: "/attendance",
            badge: "Phase 2"
          },
          {
            icon: (
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            ),
            title: "Reports & Analytics",
            desc: "View session-wise attendance, export reports, track student attendance percentage over time",
            color: "from-purple-500 to-pink-600",
            shadow: "shadow-purple-500/20",
            route: "/dashboard",
            badge: "Analytics"
          }
        ].map((card) => (
          <button
            key={card.route}
            onClick={() => navigate(card.route)}
            className={`group bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 text-left hover:bg-white/10 transition-all duration-300 hover:scale-105 hover:border-white/20 shadow-xl ${card.shadow}`}
          >
            <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center text-white mb-4 shadow-lg group-hover:scale-110 transition-transform`}>
              {card.icon}
            </div>
            <span className={`text-xs font-bold uppercase tracking-widest bg-gradient-to-r ${card.color} bg-clip-text text-transparent`}>{card.badge}</span>
            <h2 className="text-white text-xl font-bold mt-1 mb-2">{card.title}</h2>
            <p className="text-slate-400 text-sm leading-relaxed">{card.desc}</p>
            <div className="mt-4 flex items-center gap-2 text-slate-500 group-hover:text-slate-300 transition-colors">
              <span className="text-sm">Get started</span>
              <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        ))}
      </div>

      <div className="relative z-10 mt-10 flex gap-8 text-center">
        {[
          { label: "Algorithm", value: "face-api.js (TinyFaceDetector + FaceNet)" },
          { label: "Mode", value: "Real-time Video + Upload" },
          { label: "Privacy", value: "On-device Processing" }
        ].map(item => (
          <div key={item.label}>
            <div className="text-slate-500 text-xs uppercase tracking-wider">{item.label}</div>
            <div className="text-slate-300 text-sm font-medium mt-1">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
