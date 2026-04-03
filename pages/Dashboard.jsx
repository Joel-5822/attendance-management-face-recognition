import { useState, useEffect } from "react";
import { Student, AttendanceSession, AttendanceRecord } from "@/api/entities";
import { useNavigate } from "react-router-dom";

export default function Dashboard() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [students, setStudents] = useState([]);
  const [records, setRecords] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessionRecords, setSessionRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("overview"); // overview | session | student
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentHistory, setStudentHistory] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [s, st, r] = await Promise.all([
        AttendanceSession.list(),
        Student.list(),
        AttendanceRecord.list()
      ]);
      setSessions(s.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));
      setStudents(st);
      setRecords(r);
    } catch (e) {}
    setLoading(false);
  };

  const viewSession = async (session) => {
    setSelectedSession(session);
    const recs = records.filter(r => r.session_id === session.id);
    setSessionRecords(recs);
    setView("session");
  };

  const viewStudent = async (student) => {
    setSelectedStudent(student);
    const hist = records.filter(r => r.student_id === student.id);
    const sessionsMap = {};
    sessions.forEach(s => { sessionsMap[s.id] = s; });
    const enriched = hist.map(r => ({ ...r, session: sessionsMap[r.session_id] }));
    setStudentHistory(enriched.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));
    setView("student");
  };

  const deleteSession = async (id) => {
    if (!confirm("Delete this session and all its records?")) return;
    const recs = records.filter(r => r.session_id === id);
    for (const r of recs) await AttendanceRecord.delete(r.id);
    await AttendanceSession.delete(id);
    loadAll();
    if (view === "session") setView("overview");
  };

  const exportCSV = (recs, filename) => {
    const header = "Name,Roll Number,Status,Confidence,Timestamp,Marked By\n";
    const rows = recs.map(r =>
      `"${r.student_name}","${r.roll_number}","${r.status}","${r.confidence}%","${r.timestamp}","${r.marked_by}"`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  };

  const totalSessions = sessions.length;
  const totalStudents = students.length;
  const totalRecords = records.length;
  const avgAttendance = sessions.length > 0
    ? Math.round(sessions.reduce((sum, s) => sum + (s.present_count / Math.max(s.total_students, 1)) * 100, 0) / sessions.length)
    : 0;

  const filteredSessions = sessions.filter(s =>
    s.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.department?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStudentAttendance = (studentId) => {
    const recs = records.filter(r => r.student_id === studentId);
    const present = recs.filter(r => r.status === "Present").length;
    return { total: recs.length, present, pct: recs.length > 0 ? Math.round((present / recs.length) * 100) : 0 };
  };

  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-950 to-slate-900 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-400">Loading analytics...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => navigate("/")} className="text-slate-400 hover:text-white transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-3xl font-bold text-white">Analytics Dashboard</h1>
            <p className="text-purple-400 text-sm">Reports, attendance history, and insights</p>
          </div>
          <div className="ml-auto flex gap-3">
            <button onClick={() => setView("overview")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${view === "overview" ? "bg-purple-500 text-white" : "bg-white/10 text-slate-400 hover:text-white"}`}>
              Overview
            </button>
            <button onClick={() => setView("student")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${view === "student" && !selectedStudent ? "bg-purple-500 text-white" : "bg-white/10 text-slate-400 hover:text-white"}`}>
              By Student
            </button>
          </div>
        </div>

        {/* Overview */}
        {view === "overview" && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[
                { label: "Total Sessions", value: totalSessions, icon: "📅", color: "from-blue-500/20 to-indigo-500/10", border: "border-blue-500/30", text: "text-blue-400" },
                { label: "Enrolled Students", value: totalStudents, icon: "👥", color: "from-emerald-500/20 to-teal-500/10", border: "border-emerald-500/30", text: "text-emerald-400" },
                { label: "Attendance Records", value: totalRecords, icon: "📊", color: "from-purple-500/20 to-pink-500/10", border: "border-purple-500/30", text: "text-purple-400" },
                { label: "Avg Attendance", value: `${avgAttendance}%`, icon: "📈", color: "from-orange-500/20 to-amber-500/10", border: "border-orange-500/30", text: "text-orange-400" }
              ].map(s => (
                <div key={s.label} className={`bg-gradient-to-br ${s.color} border ${s.border} rounded-2xl p-6`}>
                  <div className="text-3xl mb-2">{s.icon}</div>
                  <div className={`text-3xl font-bold ${s.text}`}>{s.value}</div>
                  <div className="text-slate-400 text-sm mt-1">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Sessions list */}
            <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-bold text-xl">Session History</h2>
                <input
                  className="bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 text-sm w-56"
                  placeholder="🔍 Search sessions..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>

              {filteredSessions.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <div className="text-6xl mb-3">📋</div>
                  <p>No sessions found</p>
                  <button onClick={() => navigate("/attendance")}
                    className="mt-4 bg-purple-500 text-white px-6 py-2 rounded-xl font-medium hover:opacity-90 transition-all">
                    Start First Session
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/10">
                        {["Subject", "Department", "Semester", "Date", "Time Slot", "Present", "Absent", "Rate", "Actions"].map(h => (
                          <th key={h} className="text-left text-slate-400 text-sm pb-3 font-medium pr-4">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSessions.map(s => {
                        const absentCount = s.total_students - s.present_count;
                        const rate = s.total_students > 0 ? Math.round((s.present_count / s.total_students) * 100) : 0;
                        return (
                          <tr key={s.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                            <td className="py-3 pr-4">
                              <div className="text-white font-medium">{s.subject}</div>
                              <div className={`text-xs px-2 py-0.5 rounded-full inline-block mt-1 ${s.status === "Completed" ? "bg-emerald-500/20 text-emerald-400" : "bg-blue-500/20 text-blue-400"}`}>
                                {s.status}
                              </div>
                            </td>
                            <td className="py-3 pr-4 text-slate-400 text-sm">{s.department}</td>
                            <td className="py-3 pr-4 text-slate-400 text-sm">{s.semester}</td>
                            <td className="py-3 pr-4 text-slate-400 text-sm">{s.date}</td>
                            <td className="py-3 pr-4 text-slate-400 text-sm">{s.time_slot}</td>
                            <td className="py-3 pr-4 text-emerald-400 font-bold">{s.present_count}</td>
                            <td className="py-3 pr-4 text-red-400 font-bold">{absentCount}</td>
                            <td className="py-3 pr-4">
                              <div className="flex items-center gap-2">
                                <div className="w-16 bg-white/10 rounded-full h-2">
                                  <div className={`h-2 rounded-full ${rate >= 75 ? "bg-emerald-400" : rate >= 50 ? "bg-yellow-400" : "bg-red-400"}`}
                                    style={{ width: `${rate}%` }} />
                                </div>
                                <span className="text-slate-400 text-xs">{rate}%</span>
                              </div>
                            </td>
                            <td className="py-3">
                              <div className="flex gap-2">
                                <button onClick={() => viewSession(s)}
                                  className="bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 px-3 py-1 rounded-lg text-xs font-medium transition-colors">
                                  View
                                </button>
                                <button onClick={() => deleteSession(s.id)}
                                  className="bg-red-500/20 text-red-400 hover:bg-red-500/30 px-3 py-1 rounded-lg text-xs font-medium transition-colors">
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* Session Detail */}
        {view === "session" && selectedSession && (
          <div>
            <button onClick={() => setView("overview")} className="text-slate-400 hover:text-white text-sm mb-6 flex items-center gap-2">
              ← Back to overview
            </button>
            <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-white font-bold text-2xl">{selectedSession.subject}</h2>
                  <p className="text-slate-400">{selectedSession.department} · Semester {selectedSession.semester} · {selectedSession.date} · {selectedSession.time_slot}</p>
                </div>
                <button
                  onClick={() => exportCSV(sessionRecords, `${selectedSession.subject}_${selectedSession.date}.csv`)}
                  className="bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 px-4 py-2 rounded-xl text-sm font-medium transition-colors flex items-center gap-2">
                  📥 Export CSV
                </button>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-6">
                {[
                  { label: "Present", value: selectedSession.present_count, color: "text-emerald-400" },
                  { label: "Absent", value: selectedSession.total_students - selectedSession.present_count, color: "text-red-400" },
                  { label: "Rate", value: `${Math.round((selectedSession.present_count / Math.max(selectedSession.total_students, 1)) * 100)}%`, color: "text-purple-400" }
                ].map(s => (
                  <div key={s.label} className="bg-white/5 rounded-xl p-4 text-center">
                    <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
                    <div className="text-slate-400 text-sm">{s.label}</div>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left text-slate-400 text-sm pb-3 font-medium">Student</th>
                      <th className="text-left text-slate-400 text-sm pb-3 font-medium">Roll No</th>
                      <th className="text-left text-slate-400 text-sm pb-3 font-medium">Status</th>
                      <th className="text-left text-slate-400 text-sm pb-3 font-medium">Confidence</th>
                      <th className="text-left text-slate-400 text-sm pb-3 font-medium">Method</th>
                      <th className="text-left text-slate-400 text-sm pb-3 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionRecords.map(r => (
                      <tr key={r.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 text-white font-medium">{r.student_name}</td>
                        <td className="py-3 text-slate-400">{r.roll_number}</td>
                        <td className="py-3">
                          <span className={`px-3 py-1 rounded-full text-xs font-bold ${r.status === "Present" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="py-3 text-slate-400 text-sm">{r.confidence > 0 ? `${r.confidence}%` : "—"}</td>
                        <td className="py-3">
                          <span className={`text-xs px-2 py-1 rounded-full ${r.marked_by === "Face Recognition" ? "bg-blue-500/20 text-blue-400" : "bg-orange-500/20 text-orange-400"}`}>
                            {r.marked_by}
                          </span>
                        </td>
                        <td className="py-3 text-slate-400 text-sm">{r.timestamp || "—"}</td>
                      </tr>
                    ))}
                    {sessionRecords.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-slate-500">No records for this session</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Student view */}
        {(view === "student" && !selectedStudent) && (
          <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6">
            <h2 className="text-white font-bold text-xl mb-6">Student Attendance Summary</h2>
            {students.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <div className="text-6xl mb-3">👥</div>
                <p>No students enrolled yet</p>
                <button onClick={() => navigate("/enroll")} className="mt-4 bg-emerald-500 text-white px-6 py-2 rounded-xl font-medium hover:opacity-90 transition-all">
                  Enroll Students
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {students.map(s => {
                  const att = getStudentAttendance(s.id);
                  return (
                    <button key={s.id} onClick={() => viewStudent(s)}
                      className="bg-white/5 hover:bg-white/10 border border-white/10 hover:border-purple-500/30 rounded-2xl p-4 text-left transition-all group">
                      <div className="flex items-center gap-3 mb-4">
                        {s.face_image_url ? (
                          <img src={s.face_image_url} className="w-12 h-12 rounded-full object-cover border-2 border-purple-500/30" alt={s.name} />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold text-lg">
                            {s.name?.charAt(0)}
                          </div>
                        )}
                        <div>
                          <p className="text-white font-bold">{s.name}</p>
                          <p className="text-slate-400 text-xs">{s.roll_number}</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">Attendance</span>
                          <span className={`font-bold ${att.pct >= 75 ? "text-emerald-400" : att.pct >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                            {att.pct}%
                          </span>
                        </div>
                        <div className="bg-white/10 rounded-full h-2">
                          <div className={`h-2 rounded-full transition-all ${att.pct >= 75 ? "bg-emerald-400" : att.pct >= 50 ? "bg-yellow-400" : "bg-red-400"}`}
                            style={{ width: `${att.pct}%` }} />
                        </div>
                        <div className="flex justify-between text-xs text-slate-500">
                          <span>{att.present} present</span>
                          <span>{att.total - att.present} absent</span>
                          <span>{att.total} total</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Student history */}
        {view === "student" && selectedStudent && (
          <div>
            <button onClick={() => { setSelectedStudent(null); }} className="text-slate-400 hover:text-white text-sm mb-6 flex items-center gap-2">
              ← Back to students
            </button>
            <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6">
              <div className="flex items-center gap-4 mb-6">
                {selectedStudent.face_image_url ? (
                  <img src={selectedStudent.face_image_url} className="w-16 h-16 rounded-2xl object-cover" alt={selectedStudent.name} />
                ) : (
                  <div className="w-16 h-16 rounded-2xl bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold text-2xl">
                    {selectedStudent.name?.charAt(0)}
                  </div>
                )}
                <div>
                  <h2 className="text-white font-bold text-2xl">{selectedStudent.name}</h2>
                  <p className="text-slate-400">{selectedStudent.roll_number} · {selectedStudent.department} · Semester {selectedStudent.semester}</p>
                  {(() => {
                    const att = getStudentAttendance(selectedStudent.id);
                    return (
                      <div className="flex items-center gap-3 mt-2">
                        <span className={`font-bold text-lg ${att.pct >= 75 ? "text-emerald-400" : att.pct >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                          {att.pct}% overall
                        </span>
                        <span className="text-slate-500 text-sm">({att.present}/{att.total} sessions)</span>
                        {att.pct < 75 && <span className="bg-red-500/20 text-red-400 text-xs px-2 py-1 rounded-full">⚠️ Below 75%</span>}
                      </div>
                    );
                  })()}
                </div>
                <button onClick={() => exportCSV(studentHistory, `${selectedStudent.name}_attendance.csv`)}
                  className="ml-auto bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 px-4 py-2 rounded-xl text-sm font-medium transition-colors">
                  📥 Export CSV
                </button>
              </div>

              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    {["Subject", "Date", "Status", "Confidence", "Method"].map(h => (
                      <th key={h} className="text-left text-slate-400 text-sm pb-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {studentHistory.map(r => (
                    <tr key={r.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-3 text-white font-medium">{r.session?.subject || "—"}</td>
                      <td className="py-3 text-slate-400">{r.session?.date || "—"}</td>
                      <td className="py-3">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${r.status === "Present" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="py-3 text-slate-400 text-sm">{r.confidence > 0 ? `${r.confidence}%` : "—"}</td>
                      <td className="py-3">
                        <span className={`text-xs px-2 py-1 rounded-full ${r.marked_by === "Face Recognition" ? "bg-blue-500/20 text-blue-400" : "bg-orange-500/20 text-orange-400"}`}>
                          {r.marked_by}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {studentHistory.length === 0 && (
                    <tr><td colSpan={5} className="py-12 text-center text-slate-500">No attendance records yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
