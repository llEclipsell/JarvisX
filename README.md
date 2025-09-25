# Jarvis - AI Assistant

Jarvis is a versatile AI assistant designed to integrate seamlessly into your workflow, offering live transcription, intelligent Q\&A, and in-depth text analysis. Its intuitive, click-through interface and global shortcuts allow for effortless interaction without disrupting your primary tasks.

## Key Features

  * **Live Transcription:** Provides real-time audio transcription, allowing you to capture spoken words as they happen.
  * **AI-Powered Assistance:** Answers questions and delivers information on a wide range of subjects.
  * **Text Analysis:** Analyzes provided text to offer summaries and insights.
  * **Click-Through Mode:** The application window can be made non-interactive, so you can click through it to interact with applications behind it.
  * **Global Shortcuts:**
      * `Ctrl+Shift+C`: Toggles the click-through mode, allowing you to switch between an interactive and non-interactive window.
      * `Ctrl+\`: Toggles the visibility of the Jarvis window.
  * **Customizable and Always-on-Top:** The window is designed to be always on top, frameless, and transparent for an unobtrusive experience.

## Prerequisites

Before you begin, ensure you have the following installed:

  * **Node.js:** A JavaScript runtime environment.
  * **Rust:** A systems programming language.

## Installation and Setup

1.  **Clone the Repository:**

    ```bash
    git clone https://github.com/jarvisx/jarvisx.git
    cd jarvisx
    ```

2.  **Install Dependencies:**

    ```bash
    npm install
    ```

## Configuration

**API Keys:** Create a file named `api_keys.env` in the `src-tauri` directory and add your Gemini API key:

    GEMINI_API_KEY=YOUR_API_KEY

## Usage

  * **Development Mode:** To run the application in a development environment with hot-reloading, use the following command:

    ```bash
    npm run tauri dev
    ```

  * **Production Build:** To build a production-ready executable, run:

    ```bash
    npm run tauri build
    ```

    The output will be located in the `src-tauri/target/release` directory.

## Core Technologies

  * **[Tauri](https://tauri.app/):** A framework for building lightweight, secure, and cross-platform desktop applications using web technologies.
  * **[React](https://reactjs.org/):** A JavaScript library for building user interfaces.
  * **[Vite](https://vitejs.dev/):** A fast and opinionated web development build tool.
  * **[Rust](https://www.rust-lang.org/):** Powers the application's backend, ensuring performance and reliability.

## License

This project is licensed under the MIT License. See the [LICENSE](https://www.google.com/search?q=LICENSE) file for more details.
