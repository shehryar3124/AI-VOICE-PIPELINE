import React, { useEffect, useRef, useState } from "react";

function App() {
  const ws = useRef(null);
  const mediaRecorder = useRef(null);
  const chatEndRef = useRef(null);

  // 🔊 Web Audio API refs for raw PCM playback
  const audioCtxRef = useRef(null);
  const nextStartTimeRef = useRef(0);
  const leftoverByteRef = useRef(null); // Fixes the phase-shift distortion bug

  const [isRecording, setIsRecording] = useState(false);
  const [messages, setMessages] = useState([]);
  const [latency, setLatency] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [status, setStatus] = useState("Ready to connect");

  // 📜 Auto-scroll to the bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 🎧 Decode and Play Raw 16-bit PCM Audio (Endian-Safe)
  const playRawAudio = (arrayBuffer) => {
    if (!audioCtxRef.current) return;
    const audioCtx = audioCtxRef.current;

    // 1. STITCH BROKEN CHUNKS TOGETHER (Phase-Shift Fix)
    let bufferToProcess;
    if (leftoverByteRef.current !== null) {
      bufferToProcess = new Uint8Array(arrayBuffer.byteLength + 1);
      bufferToProcess[0] = leftoverByteRef.current;
      bufferToProcess.set(new Uint8Array(arrayBuffer), 1);
      leftoverByteRef.current = null;
    } else {
      bufferToProcess = new Uint8Array(arrayBuffer);
    }

    // 2. CHECK FOR NEW BROKEN CHUNKS
    let byteLength = bufferToProcess.byteLength;
    if (byteLength % 2 !== 0) {
      leftoverByteRef.current = bufferToProcess[byteLength - 1];
      byteLength -= 1;
    }

    // 3. THE MAGIC FIX: FORCE LITTLE-ENDIAN DECODING
    const dataView = new DataView(bufferToProcess.buffer, bufferToProcess.byteOffset, byteLength);
    const float32Data = new Float32Array(byteLength / 2);
    
    for (let i = 0; i < byteLength / 2; i++) {
      // The 'true' parameter forces Little-Endian byte order.
      // This stops the browser from reading the audio waves backward!
      const int16 = dataView.getInt16(i * 2, true); 
      float32Data[i] = int16 / 32768.0;
    }

    // 4. PLAY THE AUDIO AT NATIVE 24kHz
    const buffer = audioCtx.createBuffer(1, float32Data.length, 24000);
    buffer.getChannelData(0).set(float32Data);

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);

    // 5. JITTER BUFFER
    const currentTime = audioCtx.currentTime;
    if (nextStartTimeRef.current < currentTime) {
      nextStartTimeRef.current = currentTime + 0.1; // 100ms safety buffer
    }

    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += buffer.duration; 
  };

  // 🎤 Start recording & Connect WebSocket
  const startRecording = async () => {
    try {
      setStatus("Requesting Microphone...");
      
      // Explicit Echo Cancellation to prevent stammering loops
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });

      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume();
      }
      nextStartTimeRef.current = audioCtxRef.current.currentTime;
      leftoverByteRef.current = null;

      setStatus("Connecting to Server...");
      ws.current = new WebSocket("ws://localhost:8000/ws");
      ws.current.binaryType = "arraybuffer";

      ws.current.onopen = () => {
        setStatus("Connected & Listening...");
        setIsRecording(true);

        mediaRecorder.current = new MediaRecorder(stream, { mimeType: "audio/webm" });

        mediaRecorder.current.ondataavailable = (event) => {
          if (event.data.size > 0 && ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(event.data);
          }
        };

        mediaRecorder.current.start(250);
      };

      ws.current.onmessage = async (event) => {
        if (typeof event.data === "string") {
          const data = JSON.parse(event.data);
          
          if (data.type === "transcript") {
            setMessages((prev) => [...prev, { role: "user", text: data.text }]);
          } else if (data.type === "response") {
            setMessages((prev) => [...prev, { role: "ai", text: data.text }]);
          } else if (data.type === "latency_breakdown") {
            setLatency(data.total);
            setMetrics({
              sttToLlm: data.t1 - data.t0,
              llmTtft: data.t2 - data.t1,
              llmToTts: data.t3 - data.t2,
              ttsTtfa: data.t4 - data.t3,
            });
          }
        } else {
          playRawAudio(event.data);
        }
      };

      ws.current.onclose = () => {
        setStatus("Call Ended");
        setIsRecording(false);
        if (mediaRecorder.current && mediaRecorder.current.state !== "inactive") {
          mediaRecorder.current.stream.getTracks().forEach((track) => track.stop());
          mediaRecorder.current.stop();
        }
      };
    } catch (err) {
      console.error("Error starting pipeline:", err);
      setStatus("Error: Check Microphone Permissions");
    }
  };

  const stopRecording = () => {
    if (ws.current) ws.current.close();
  };

  return (
    <div style={styles.container}>
      <div style={{...styles.bgGlow, ...(isRecording ? styles.bgGlowActive : {})}}></div>

      <div style={styles.content}>
        <div style={styles.header}>
          <div style={styles.badge}>{isRecording ? "🔴 Live Call" : "⚪ Offline"}</div>
          <h1 style={styles.title}>Call-Link AI Agent</h1>
          <p style={styles.statusText}>{status}</p>
        </div>

        {/* ⏱ Expanded Latency Dashboard */}
        <div style={styles.dashboard}>
          <div style={styles.latencyHeader}>
            <span style={styles.latencyLabel}>Total Pipeline Latency</span>
            {latency ? (
              <span style={{ ...styles.latencyValue, color: latency > 1.2 ? "#ef4444" : "#10b981" }}>
                {latency.toFixed(3)}s
              </span>
            ) : (
              <span style={styles.latencyValue}>--</span>
            )}
          </div>

          {metrics && (
            <div style={styles.metricsGrid}>
              <div style={styles.metricItem}>
                <span style={styles.metricName}>STT ➔ LLM</span>
                <span style={styles.metricTime}>{metrics.sttToLlm.toFixed(3)}s</span>
              </div>
              <div style={styles.metricItem}>
                <span style={styles.metricName}>LLM First Token</span>
                <span style={styles.metricTime}>{metrics.llmTtft.toFixed(3)}s</span>
              </div>
              <div style={styles.metricItem}>
                <span style={styles.metricName}>LLM ➔ TTS</span>
                <span style={styles.metricTime}>{metrics.llmToTts.toFixed(3)}s</span>
              </div>
              <div style={styles.metricItem}>
                <span style={styles.metricName}>TTS First Audio</span>
                <span style={styles.metricTime}>{metrics.ttsTtfa.toFixed(3)}s</span>
              </div>
            </div>
          )}
        </div>

        {/* 💬 Chat Box */}
        <div style={styles.chatBox}>
          {messages.length === 0 ? (
            <div style={styles.emptyState}>
              <span style={{fontSize: "2rem", marginBottom: "10px", display: "block"}}>🎙️</span>
              Click "Start Call" and introduce yourself...
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} style={msg.role === "user" ? styles.userRow : styles.aiRow}>
                <div style={msg.role === "user" ? styles.userBubble : styles.aiBubble}>
                  {msg.text}
                </div>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        {/* 🎤 Controls */}
        <div style={styles.controls}>
          {!isRecording ? (
            <button style={styles.startButton} onClick={startRecording}>
              <span style={{marginRight: "8px"}}>📞</span> Start Call
            </button>
          ) : (
            <div style={styles.recordingContainer}>
              <div style={styles.pulseWrapper}>
                <div style={styles.pulseRing}></div>
                <div style={styles.pulseDot}></div>
              </div>
              <button style={styles.stopButton} onClick={stopRecording}>
                <span style={{marginRight: "8px"}}>⏹</span> End Call
              </button>
            </div>
          )}
        </div>
      </div>

      <style>
        {`
          @keyframes pulseRing {
            0% { transform: scale(0.8); opacity: 0.8; }
            100% { transform: scale(2.5); opacity: 0; }
          }
          @keyframes fadeGlow {
            0% { opacity: 0.3; }
            50% { opacity: 0.6; }
            100% { opacity: 0.3; }
          }
          ::-webkit-scrollbar { width: 8px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        `}
      </style>
    </div>
  );
}

const styles = {
  container: { position: "relative", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", justifyContent: "center", padding: "40px 20px", backgroundColor: "#020617", color: "#f8fafc", minHeight: "100vh", overflow: "hidden" },
  bgGlow: { position: "absolute", top: "20%", left: "50%", transform: "translate(-50%, -50%)", width: "600px", height: "400px", background: "radial-gradient(circle, rgba(56,189,248,0.1) 0%, rgba(2,6,23,0) 70%)", zIndex: 0, transition: "all 1s ease" },
  bgGlowActive: { background: "radial-gradient(circle, rgba(16,185,129,0.15) 0%, rgba(2,6,23,0) 70%)", animation: "fadeGlow 4s infinite" },
  content: { position: "relative", zIndex: 1, width: "100%", maxWidth: "600px", display: "flex", flexDirection: "column", gap: "24px" },
  
  header: { textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" },
  badge: { fontSize: "0.75rem", fontWeight: "600", padding: "4px 12px", background: "#1e293b", borderRadius: "20px", border: "1px solid #334155", color: "#cbd5e1", letterSpacing: "0.5px", textTransform: "uppercase" },
  title: { margin: 0, fontSize: "2.2rem", fontWeight: "800", background: "linear-gradient(to right, #38bdf8, #818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" },
  statusText: { margin: 0, fontSize: "0.9rem", color: "#64748b", fontWeight: "500" },
  
  dashboard: { background: "rgba(30, 41, 59, 0.7)", backdropFilter: "blur(12px)", border: "1px solid rgba(255, 255, 255, 0.1)", borderRadius: "16px", padding: "20px", boxShadow: "0 10px 30px -10px rgba(0,0,0,0.5)" },
  latencyHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "15px", borderBottom: "1px solid rgba(255, 255, 255, 0.05)", marginBottom: "15px" },
  latencyLabel: { fontSize: "1rem", color: "#94a3b8", fontWeight: "600" },
  latencyValue: { fontSize: "1.5rem", fontWeight: "800", fontFamily: "ui-monospace, monospace" },
  metricsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" },
  metricItem: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(15, 23, 42, 0.5)", padding: "10px 14px", borderRadius: "8px" },
  metricName: { fontSize: "0.8rem", color: "#cbd5e1" },
  metricTime: { fontSize: "0.9rem", fontFamily: "ui-monospace, monospace", color: "#38bdf8", fontWeight: "600" },
  
  chatBox: { flexGrow: 1, height: "40vh", minHeight: "350px", overflowY: "auto", padding: "24px", borderRadius: "16px", background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(12px)", border: "1px solid rgba(255, 255, 255, 0.05)", display: "flex", flexDirection: "column", gap: "16px", boxShadow: "inset 0 2px 10px rgba(0,0,0,0.2)" },
  emptyState: { textAlign: "center", color: "#475569", margin: "auto", fontSize: "1.1rem", fontWeight: "500" },
  userRow: { display: "flex", justifyContent: "flex-end", width: "100%" },
  aiRow: { display: "flex", justifyContent: "flex-start", width: "100%" },
  userBubble: { background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "white", padding: "14px 18px", borderRadius: "20px 20px 4px 20px", maxWidth: "80%", fontSize: "0.95rem", lineHeight: "1.5", boxShadow: "0 4px 15px rgba(37, 99, 235, 0.2)" },
  aiBubble: { background: "#1e293b", color: "#f8fafc", padding: "14px 18px", borderRadius: "20px 20px 20px 4px", border: "1px solid rgba(255, 255, 255, 0.1)", maxWidth: "80%", fontSize: "0.95rem", lineHeight: "1.5", boxShadow: "0 4px 15px rgba(0,0,0,0.1)" },
  
  controls: { display: "flex", justifyContent: "center", width: "100%", marginTop: "10px" },
  startButton: { padding: "16px 36px", fontSize: "1.1rem", fontWeight: "700", borderRadius: "50px", border: "1px solid rgba(16, 185, 129, 0.5)", cursor: "pointer", background: "linear-gradient(135deg, #10b981, #059669)", color: "white", boxShadow: "0 10px 25px -5px rgba(16, 185, 129, 0.4)", transition: "all 0.2s ease", display: "flex", alignItems: "center" },
  recordingContainer: { display: "flex", alignItems: "center", gap: "20px", background: "rgba(30, 41, 59, 0.8)", padding: "10px 10px 10px 24px", borderRadius: "50px", border: "1px solid rgba(255, 255, 255, 0.1)", backdropFilter: "blur(10px)" },
  stopButton: { padding: "12px 28px", fontSize: "1rem", fontWeight: "700", borderRadius: "50px", border: "none", cursor: "pointer", background: "#ef4444", color: "white", boxShadow: "0 4px 15px rgba(239, 68, 68, 0.3)", display: "flex", alignItems: "center" },
  pulseWrapper: { position: "relative", width: "12px", height: "12px" },
  pulseDot: { position: "absolute", width: "12px", height: "12px", background: "#10b981", borderRadius: "50%", zIndex: 2 },
  pulseRing: { position: "absolute", top: "-4px", left: "-4px", width: "20px", height: "20px", background: "#10b981", borderRadius: "50%", zIndex: 1, animation: "pulseRing 1.5s cubic-bezier(0.215, 0.61, 0.355, 1) infinite" }
};

export default App;