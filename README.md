# 🎙️ Task 2: Real-Time Voice AI Pipeline

A high-performance, ultra-low latency conversational voice agent built with React, FastAPI, Deepgram, and OpenAI. 

This project implements a fully cascaded **STT → LLM → TTS** pipeline using end-to-end WebSockets and raw PCM audio streaming. It is optimized for natural conversational turn-taking, artifact-free audio playback, and sub-second response times, complete with a real-time latency tracking dashboard (T0 to T5).

## 🏗️ Architecture

The pipeline relies on a fully asynchronous, bidirectional WebSocket architecture to minimize Time To First Audio (TTFA).

1. **Frontend (React):** Captures microphone input and streams standard `webm` audio chunks. It receives raw binary audio chunks and decodes them natively using the Web Audio API.
2. **Backend (FastAPI):** Acts as the asynchronous orchestrator.
3. **STT (Deepgram Nova-2 via Azure):** Streams transcripts in real-time.
4. **LLM (OpenAI GPT-4o-mini via Azure):** Generates conversational responses and streams text tokens.
5. **TTS (Deepgram Aura):** Converts text tokens into raw 16-bit linear PCM audio and streams it back to the client.

## 🚀 Low-Latency & Audio Optimizations

Building a cascaded pipeline introduces significant latency and audio artifacts. The following engineering optimizations were applied to achieve native-level performance:

### 1. Raw PCM & Web Audio API Integration
Instead of waiting for complete MP3 files (which require headers and REST API blocking), the backend streams raw, uncompressed 16-bit linear PCM bytes directly to the frontend. The React app uses the `AudioContext` to decode and stitch these floats together in real-time, bypassing HTML5 `<audio>` player overhead.

### 2. The "Phase-Shift" Byte Stitcher
When streaming raw 16-bit audio over WebSockets, network packets often arrive with an odd number of bytes. If fed directly to a 16-bit decoder, this permanently shifts the phase of the audio stream, resulting in deafening static. 
* **Fix:** Implemented a `leftoverByteRef` in the frontend to temporarily cache hanging bytes and prepend them to the next incoming chunk, ensuring perfect 16-bit alignment.

### 3. Explicit Little-Endian Decoding
Browsers and OS architectures differ in byte-order processing. Deepgram streams in Little-Endian format. 
* **Fix:** Used a JavaScript `DataView` with the `true` flag (`dataView.getInt16(i * 2, true)`) to force Little-Endian decoding, preventing the browser from reading the audio waves backward and causing robotic distortion.

### 4. Native Sample Rate Matching
Requesting 48kHz audio from Deepgram's Aura models (which are natively trained at 24kHz) forces the server to artificially upsample the audio, increasing payload size and introducing metallic crunching.
* **Fix:** Hardcoded both the Deepgram TTS WebSocket request and the frontend `AudioBuffer` to `24000 Hz`, ensuring 1:1 bit-perfect playback and reducing bandwidth usage by 50%.

### 5. Dynamic Jitter Buffer
Because WebSocket packets arrive inconsistently due to network jitter, playing them instantly causes micro-stammers as the audio player temporarily starves. 
* **Fix:** Implemented a lightweight `100ms` forward-looking jitter buffer to absorb network hiccups and ensure buttery-smooth playback.

### 6. Semantic LLM Chunking
Sending text to the TTS engine based on character counts breaks natural voice prosody. 
* **Fix:** The LLM stream buffer only flushes to the TTS WebSocket when it hits natural linguistic boundaries (punctuation like `.`, `?`, `!`, `,`), resulting in highly realistic human inflection.

### 7. Microphone-First Setup
* **Fix:** The React frontend explicitly awaits `getUserMedia` permissions *before* dialing the FastAPI WebSocket, preventing the STT engine from hitting idle timeouts while waiting for user browser clicks.

## 📊 Latency Tracking (T0 - T5)
The application features an integrated dashboard that tracks the exact timestamps of the pipeline in real-time. 

* **STT ➔ LLM (T1 - T0):** Latency of network request to the LLM.
* **LLM First Token (T2 - T1):** Time-to-First-Token (TTFT).
* **LLM ➔ TTS (T3 - T2):** Time taken to generate the first complete semantic clause.
* **TTS First Audio (T4 - T3):** Time-to-First-Byte (TTFB) from the TTS engine.
* **Total Latency (T5 - T0):** Full round-trip time.
