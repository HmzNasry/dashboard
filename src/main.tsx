import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

// No StrictMode: its dev double-mount would open/close the WebSocket twice.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
