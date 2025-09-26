
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::process::{Command, Stdio, Child};
use std::sync::Mutex;
use std::thread;
use std::env;
use std::time::Instant;
use tauri::{Manager, AppHandle, Emitter, PhysicalPosition};
use std::io::Read;
use regex::Regex;

// --- UPDATED: Correct imports for the global shortcut plugin ---
use tauri_plugin_global_shortcut::{GlobalShortcutExt};

use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE};

// --- Shared State to hold the running process ---
struct AppState {
    transcription_process: Option<Child>,
    click_through_enabled: bool,
    last_shortcut_time: Instant
}
impl AppState {
    fn new() -> Self {
        Self { 
            transcription_process: None,
            click_through_enabled: true,
            last_shortcut_time: Instant::now()
        }
    }
}

// --- Live Transcription using whisper-stream.exe ---
#[tauri::command]
fn start_live_transcription(
    app_handle: AppHandle,
    stream_exe_path: String,
    model_path: String,
    state: tauri::State<Mutex<AppState>>,
) -> Result<(), String> {
    let mut state_guard = state.lock().unwrap();
    let mut command = Command::new(&stream_exe_path);
    command.args(["-m", &model_path, "-t", "8"]);
    command.stdout(Stdio::piped());
    let mut child = command.spawn().map_err(|e| format!("Failed to spawn process: {}", e))?;
    let mut stdout = child.stdout.take().expect("Failed to capture stdout");

    // Precompile ANSI escape regex (e.g. \x1b[...m or \x1b[2K)
    let ansi_re = Regex::new(r"\x1B\[[0-?]*[ -/]*[@-~]").unwrap();

    // Spawn thread to read raw bytes from stdout and detect \r vs \n
    let app_handle_clone = app_handle.clone();
    thread::spawn(move || {
        let mut buffer = [0u8; 1024];
        let mut acc: Vec<u8> = Vec::new();

        loop {
            match stdout.read(&mut buffer) {
                Ok(0) => {
                    // EOF
                    if !acc.is_empty() {
                        if let Ok(s) = String::from_utf8(acc.clone()) {
                            let cleaned = ansi_re.replace_all(&s, "").to_string().trim().to_string();
                            if !cleaned.is_empty() {
                                let _ = app_handle_clone.emit("final_transcription", cleaned);
                            }
                        }
                    }
                    break;
                }
                Ok(n) => {
                    for &b in &buffer[..n] {
                        match b {
                            b'\r' => {
                                // Interim update: emit current accumulator as "in-progress"
                                if !acc.is_empty() {
                                    if let Ok(s) = String::from_utf8(acc.clone()) {
                                        let cleaned = ansi_re.replace_all(&s, "").to_string().trim().to_string();
                                        if !cleaned.is_empty() {
                                            let _ = app_handle_clone.emit("new_transcription", cleaned.clone());
                                        }
                                    }
                                } else {
                                    // sometimes \r is followed by new bytes, so emit empty -> ignore
                                }
                                // keep acc (some streams update with \r then more bytes, sometimes they also send newline later)
                                acc.clear(); // optional depending on how the producer behaves
                            }
                            b'\n' => {
                                // Finalized line: emit as final
                                if !acc.is_empty() {
                                    if let Ok(s) = String::from_utf8(acc.clone()) {
                                        let cleaned = ansi_re.replace_all(&s, "").to_string().trim().to_string();
                                        if !cleaned.is_empty() {
                                            let _ = app_handle_clone.emit("final_transcription", cleaned.clone());
                                        }
                                    }
                                    acc.clear();
                                } else {
                                    // newline with empty acc -> ignore
                                }
                            }
                            _ => {
                                acc.push(b);
                            }
                        }
                    }
                }
                Err(err) => {
                    eprintln!("Error reading stdout: {}", err);
                    break;
                }
            }
        }
    });

    state_guard.transcription_process = Some(child);
    Ok(())
}

#[tauri::command]
fn stop_live_transcription(state: tauri::State<Mutex<AppState>>) -> Result<(), String> {
    let mut state_guard = state.lock().unwrap();
    if let Some(mut child) = state_guard.transcription_process.take() {
        child.kill().map_err(|e| format!("Failed to kill process: {}", e))?;
        println!("Live transcription process stopped.");
    }
    Ok(())
}

// --- Gemini API Logic ---
#[derive(Serialize)] struct GeminiRequest { contents: Vec<Content> }
#[derive(Serialize)] struct Content { parts: Vec<Part> }
#[derive(Serialize)] struct Part { text: String }
#[derive(Deserialize)] struct GeminiResponse { candidates: Vec<Candidate> }
#[derive(Deserialize)] struct Candidate { content: ContentResponse }
#[derive(Deserialize)] struct ContentResponse { parts: Vec<PartResponse> }
#[derive(Deserialize)] struct PartResponse { text: String }

#[tauri::command]
async fn call_gemini_api(prompt: String) -> Result<String, String> {
    let api_key = env::var("GEMINI_API_KEY").map_err(|_| "GEMINI_API_KEY not found in .env file".to_string())?;
        let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={}",
        api_key
    );
    let request_body = GeminiRequest { contents: vec![Content { parts: vec![Part { text: prompt }] }] };
    let client = reqwest::Client::new();
    let response = client.post(&url).json(&request_body).send().await.map_err(|e| format!("Failed to send request to Gemini API: {}", e))?;
    if response.status().is_success() {
        let gemini_response = response.json::<GeminiResponse>().await.map_err(|e| format!("Failed to parse Gemini response: {}", e))?;
        if let Some(candidate) = gemini_response.candidates.get(0) {
            if let Some(part) = candidate.content.parts.get(0) { return Ok(part.text.clone()); }
        }
        Err("No content found in Gemini response".to_string())
    } else {
        let error_body = response.text().await.unwrap_or_else(|_| "Unknown API error".to_string());
        Err(format!("Gemini API error: {}", error_body))
    }
}

// --- Window Invisibility Logic ---
fn make_window_invisible_to_capture(window: &tauri::WebviewWindow) {
    let hwnd = HWND(window.hwnd().unwrap().0 as isize);
    unsafe { let _ = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE); }
}

#[tauri::command]
fn toggle_clickthrough(
    window: tauri::WebviewWindow,
    enable: bool,
    state: tauri::State<Mutex<AppState>>
) -> Result<(), String> {
    // Update window behavior
    window.set_ignore_cursor_events(enable).map_err(|e| format!("Failed to set clickthrough: {}", e))?;

    // Update shared state
    let mut state_guard = state.lock().unwrap();
    state_guard.click_through_enabled = enable;

    // Emit event so frontend stays in sync
    let _ = window.emit("click_through_toggled", enable);

    Ok(())
}

fn main() {
    dotenvy::from_filename("api_keys.env").expect("Failed to load api_keys.env file");
    
    tauri::Builder::default()
        .manage(Mutex::new(AppState::new()))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let main_window = app.get_webview_window("main").unwrap();

            // Make invisible to screen capture
            make_window_invisible_to_capture(&main_window);

            // Transparent + frameless window
            main_window.set_decorations(false).unwrap();
            main_window.set_always_on_top(true).unwrap();
            main_window.set_ignore_cursor_events(true).unwrap(); // allow clicks at startup

            // get monitor size
            if let Some(monitor) = main_window.current_monitor().unwrap() {
                let size = monitor.size();
                
                // place window at top-center
                let window_size = main_window.outer_size().unwrap();
                let x = (size.width / 2) as i32 - (window_size.width as i32 / 2);
                let y = 0; // very top of the screen

                main_window.set_position(PhysicalPosition::new(x, y)).unwrap();
            }

            // Get the shortcut manager
            let shortcuts = app.global_shortcut();
            let _app_handle = app.handle().clone();

            // 1. Unregister to prevent hot-reload errors
            let _ = shortcuts.unregister("Ctrl+Shift+C");

            // 2. Register the shortcut and provide the handler as a second argument
            shortcuts.on_shortcut("Ctrl+Shift+C", move |app,_shortcut,_event| {
                let window = app.get_webview_window("main").unwrap();
                let state = app.state::<Mutex<AppState>>();
                
                let mut state_guard = state.lock().unwrap();
                let now = Instant::now();
                
                if now.duration_since(state_guard.last_shortcut_time).as_millis() > 200 {
                    // Toggle the boolean state
                    state_guard.click_through_enabled = !state_guard.click_through_enabled;
                    let is_enabled = state_guard.click_through_enabled;
                    
                    // Apply the new state to the window
                    let _ = window.set_ignore_cursor_events(is_enabled);
                    
                    // Emit the new state to the frontend
                    let _ = window.emit("click_through_toggled", is_enabled);
                    
                    // Update the timestamp
                    state_guard.last_shortcut_time = now;
                }
            }).expect("Failed to set shortcut handler");  
                     
            // hide/show toggle
            let _ = shortcuts.unregister("Ctrl+\\");
            shortcuts.on_shortcut("Ctrl+\\", move |app, _shortcut, _event| {
                if let Some(window) = app.get_webview_window("main") {
                    
                    let state = app.state::<Mutex<AppState>>();

                    let now = Instant::now();
                    let mut state_guard = state.lock().unwrap();

                    if now.duration_since(state_guard.last_shortcut_time).as_millis() > 200 {
                        if window.is_visible().unwrap_or(false) {
                            let _ = window.hide();
                        } 
                        else {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        state_guard.last_shortcut_time = now;
                    }
                }}).expect("Failed to set visibility toggle shortcut");
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_live_transcription,
            stop_live_transcription,
            call_gemini_api,
            toggle_clickthrough
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}