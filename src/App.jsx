
import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import ReactMarkdown from "react-markdown";
import { getCurrentWindow } from '@tauri-apps/api/window';
import logoVideo from './assets/JarvisV2TurqVid.mp4';
import { resolveResource } from "@tauri-apps/api/path";
import './App.css';

function App() {

  async function getResourcePaths() {
    const streamExe = await resolveResource("resources/whisper-stream.exe");
    const modelBin = await resolveResource("resources/models/ggml-base.en.bin");
    return { streamExe, modelBin };
  }

  const [isRecording, setIsRecording] = useState(false);
  
  // --- Transcript state is now split for better live updates ---
  const [finalizedTranscript, setFinalizedTranscript] = useState([]);
  const [inProgressTranscript, setInProgressTranscript] = useState('');
  
  const [aiResponse, setAiResponse] = useState('');
  const [generalQuery, setGeneralQuery] = useState('');
  const [status, setStatus] = useState('Ready.');
  
  // --- state for click-through and the timer ---
  const [clickThrough, setClickThrough] = useState(true); // Start as click-through
  const speechPauseTimer = useRef(null);

  // UI states for widget/panel
  const [widgetOpen, setWidgetOpen] = useState(true);
  const [listenOpen, setListenOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('transcript');

  // Ref to remember previous click-through state during drag
  const appWindow = useRef(null);

  useEffect(() => {
    appWindow.current = getCurrentWindow();
  }, []);

  // --- Updated transcription listener with timer logic ---
  useEffect(() => {
    let unlistenInterim;
    let unlistenFinal;

    const setupListeners = async () => {
      unlistenInterim = await listen('new_transcription', (event) => {
        const text = event.payload;
        // update the in-progress line
        setInProgressTranscript(text);
        // reset pause timer as before
        clearTimeout(speechPauseTimer.current);
        speechPauseTimer.current = setTimeout(() => {
          // If we don't get final_transcription after a pause, optionally finalize
          if (text) {
            setFinalizedTranscript(prev => [...prev, text]);
            setInProgressTranscript('');
          }
        }, 1500);
      });

      unlistenFinal = await listen('final_transcription', (event) => {
        const text = event.payload;
        if (text) {
          setFinalizedTranscript(prev => [...prev, text]);
        }
        setInProgressTranscript('');
        // clear timer to avoid double-finalization
        clearTimeout(speechPauseTimer.current);
      });
    };

    setupListeners();

    return () => {
      if (unlistenInterim) unlistenInterim.then(f => f());
      if (unlistenFinal) unlistenFinal.then(f => f());
      clearTimeout(speechPauseTimer.current);
    };
  }, []);


  // --- Added listener for global shortcut event ---
  useEffect(() => {
    const unlisten = listen('click_through_toggled', (event) => {
      const newState = event.payload; // The backend sends the new boolean state
      setClickThrough(newState);
      setStatus(newState ? 'Window is click-through.' : 'Window is interactive.');
    });
    
    // Cleanup the listener when the component unmounts
    return () => { 
      unlisten.then(f => f()); 
    };
  }, []);

  // --- Start / Stop Live Transcription ---
  const handleToggleRecording = async () => {
    if (!isRecording) {
      try {
        setStatus('Recording...');
        // Reset new transcript states ---
        setFinalizedTranscript([]);
        setInProgressTranscript('');
        setAiResponse('');

        const { streamExe, modelBin } = await getResourcePaths();

        await invoke('start_live_transcription', { 
          streamExePath: streamExe, 
          modelPath: modelBin
        });
        setIsRecording(true);
      } 
      catch (error) {
        console.error(error);
        setStatus(`Error: ${error}`);
      }
    } 
    else {
      try {
        await invoke('stop_live_transcription');
        // Finalize any remaining text when stopping
        if (inProgressTranscript) {
          setFinalizedTranscript(prev => [...prev, inProgressTranscript]);
        }
        setInProgressTranscript('');
        setStatus('Ready.');
        setIsRecording(false);
      } catch (error) {
        console.error(error);
        setStatus(`Error: ${error}`);
      }
    }
  };

  // --- Ask Gemini API ---
  const handleAskGemini = async (prompt) => {
    if (!prompt) return;
    try {
      setStatus('Thinking...');
      const response = await invoke('call_gemini_api', { 
        prompt: `${prompt}\n\nIMPORTANT: Format your response using Markdown with line breaks, bullet points, and code blocks when relevant.` 
      });
      setAiResponse(response);
      setActiveTab('ai');
      setStatus('Ready.');
      setWidgetOpen(true);
    } catch (error) {
      console.error(error);
      setAiResponse(`Error: ${error}`);
      setActiveTab('ai');
      setStatus('Ready.');
      setWidgetOpen(true);
    }
  };

  // --- Analyze Transcript ---
  const handleAnalyze = () => {
    // Use the combined transcript for analysis
    const fullTranscript = [...finalizedTranscript, inProgressTranscript].join('\n');
    handleAskGemini(
      `You are a helpful AI assistant. 
       When given a transcript or question:
       - Give a clear, detailed, yet concise explanation. 
       - If solving requires code, provide working code snippets. 
       - If no code is needed, just explain clearly. 
       - Do not output "Summary" or "Action Items" format. 
       - Act like a normal conversational assistant.

       Now, based on the following transcript, explain/solve: ${fullTranscript}`
    );
  };

  // --- Toggle click-through mode ---
  const handleToggleClickThrough = async () => {
    try {
      const newState = !clickThrough;
      await invoke('toggle_clickthrough', { enable: newState });
      setClickThrough(newState);
      setStatus(newState ? 'Window is click-through.' : 'Window is interactive.');
    } catch (err) {
      console.error('Failed to toggle clickthrough:', err);
    }
  };

  // Combine transcript parts for display ---
  const transcript = [...finalizedTranscript, inProgressTranscript].join('\n');

  // Ensure interactive before dragging, remember previous state
  const startDragWithClickThroughHandling = async (e) => {
    // stopPropagation so clicks on the bar don't trigger other handlers
    if (e && e.stopPropagation) e.stopPropagation();

    try {
      // remember whether window was click-through
      prevClickThroughRef.current = clickThrough;

      if (clickThrough) {
        // disable click-through so we can receive mouse events for dragging
        await invoke('toggle_clickthrough', { enable: false });
        setClickThrough(false);
        setStatus('Window is interactive.');
      }

      // start native drag (this requires a user gesture — i.e., mousedown)
      await appWindow.startDragging();
    } catch (err) {
      console.error('Drag start error:', err);
    }
  };

  // On mouse up, restore click-through if it was previously enabled
  const stopDragRestoreClickThrough = async (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    try {
      if (prevClickThroughRef.current) {
        await invoke('toggle_clickthrough', { enable: true });
        setClickThrough(true);
        setStatus('Window is click-through.');
      }
    } catch (err) {
      console.error('Restore click-through error:', err);
    } finally {
      prevClickThroughRef.current = null;
    }
  };

  // To hide the window
  const handleHideWindow = async (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    try {
      // Add a check for appWindow.current and call .hide() on it as appWindow is a useRef
      if (appWindow.current) {
        await appWindow.current.hide();
      }
    }
    catch (err) {
      console.error('Failed to hide window:', err);
    }
  };

  return (
    <div className="app-root">
      {/* Floating top-centered widget */}
      <div className={`floating-widget ${widgetOpen ? 'open' : 'closed'}`}>
        {/* Collapsed-bar */}
        <div className="widget-bar" 
          onClick={() => setWidgetOpen(true)} 
          role="button" 
          aria-label="Open assistant"
          onMouseDown={startDragWithClickThroughHandling}    
          onMouseUp={stopDragRestoreClickThrough}            
          onTouchStart={startDragWithClickThroughHandling}   
          onTouchEnd={stopDragRestoreClickThrough}           
        >
          <div className="widget-left">
            <div className="icon-circle" title="Assistant">
              <video 
                width="18" 
                height="18" 
                autoPlay 
                loop 
                muted 
                playsInline
              >
                <source src={logoVideo} type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            </div>
            <div className="bar-label">Jarvis</div>
          </div>

          <div className="widget-actions">
            <button
              className={`mini-btn listen ${isRecording ? 'recording' : ''}`}
              onClick={(e) => { 
                e.stopPropagation(); 
                
                // 1. This function now handles both starting AND stopping
                handleToggleRecording(); 
                
                // 2. Toggle the "listen" specific UI
                setListenOpen(prevState => !prevState); 
                
                // 3. Only open the widget and set tab when we START recording
                if (!isRecording) { 
                  setWidgetOpen(true); 
                  setActiveTab('transcript'); 
                }
              }}
            >
              <span className="dot" />
              {isRecording ? 'Stop' : 'Listen'}{/* Bonus: Dynamic text */}
            </button>

            <button className="mini-text" 
              onClick={(e) => { 
                e.stopPropagation(); 
                // This function gets the current value and returns the opposite
                setWidgetOpen(currentValue => !currentValue); 
                setActiveTab('ai'); 
              }}>
              Ask question
            </button>

            <button className="icon-hide" onClick={handleHideWindow}>
              ✕
            </button>
          </div>
        </div>

        {/* Expanded panel */}
        <div className={`panel ${widgetOpen ? 'panel-open' : ''}`} onClick={(e) => e.stopPropagation()}>
          <div className="panel-header">
            <div className="panel-title">
              <strong>{activeTab === 'transcript' ? 'Live Transcript' : 'Assistant'}</strong>
              <span className="panel-sub">{status}</span>
            </div>

            <div className="panel-controls">
              <button className={`pill ${isRecording ? 'active' : ''}`} onClick={() => { handleToggleRecording(); setActiveTab('transcript'); }}>
                {isRecording ? 'Stop' : 'Listen'}
              </button>
              <button className="pill" onClick={() => { setActiveTab('ai'); }}>
                Analyze
              </button>
              <button className="pill" onClick={handleToggleClickThrough}>
                {clickThrough ? 'Disable ClickThrough' : 'Enable ClickThrough'}
              </button>
              <button className="icon-hide" onClick={() => setWidgetOpen(false)}>Hide</button>
            </div>
          </div>

          <div className="panel-body">
            <div className="left-column">
              <div className="tab-header">
                <button className={`tab ${activeTab === 'transcript' ? 'active' : ''}`} onClick={() => setActiveTab('transcript')}>Transcript</button>
                <button className={`tab ${activeTab === 'ai' ? 'active' : ''}`} onClick={() => setActiveTab('ai')}>AI</button>
              </div>

              <div className="content-area">
                {activeTab === 'transcript' ? (
                  <pre className="transcript-box">{transcript || 'Live transcript will appear here...'}</pre>
                ) : (
                  <div className="ai-box">
                    {aiResponse ? <ReactMarkdown>{aiResponse}</ReactMarkdown> : <p>AI response will appear here.</p>}
                  </div>
                )}
              </div>
            </div>

            <div className="right-column">
              <div className="right-header">Quick Actions</div>
              <div className="right-body">
                <button className="action" onClick={handleAnalyze} disabled={!transcript || isRecording}>Analyze Transcript</button>
                <div className="divider" />
                <div className="input-row">
                  <input
                    type="text"
                    value={generalQuery}
                    onChange={(e) => setGeneralQuery(e.target.value)}
                    placeholder="Ask Gemini anything..."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleAskGemini(generalQuery);
                        setGeneralQuery('');
                      }
                    }}
                  />
                  <button className="send" onClick={() => { handleAskGemini(generalQuery); setGeneralQuery(''); }} disabled={!generalQuery}>→</button>
                </div>
                <p className="status-small">{status}</p>
              </div>
            </div>
          </div>

          <div className="panel-footer">
            <small>
              Tip: click Listen to start live transcript<br /> 
              — click Hide to collapse<br /> 
              — press "Ctrl+Shift+C" to toggle click-through mode<br /> 
              — press "Ctrl+\ to hide Jarvis.</small>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;