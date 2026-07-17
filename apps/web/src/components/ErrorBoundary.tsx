import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    // Log telemetry crash here
    console.error("Uncaught client-side exception:", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0d031f",
          color: "#ffffff",
          fontFamily: "Inter, sans-serif",
          padding: "20px"
        }}>
          <div style={{
            background: "#1b122c",
            border: "1px solid #31254d",
            borderRadius: "16px",
            padding: "32px",
            maxWidth: "500px",
            width: "100%",
            textAlign: "center"
          }}>
            <span style={{ fontSize: "48px", display: "block" }}>⚠️</span>
            <h1 style={{ fontSize: "22px", marginTop: "16px", fontWeight: 700 }}>Something went wrong</h1>
            <p style={{ color: "#a78bfa", fontSize: "14px", marginTop: "8px", lineHeight: "1.5" }}>
              CRM Ads encountered a client-side execution exception. We have captured details of this issue for our engineers.
            </p>

            <button
              onClick={this.handleReload}
              style={{
                background: "#7033f5",
                color: "#ffffff",
                border: "none",
                borderRadius: "8px",
                padding: "10px 20px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
                marginTop: "24px",
                width: "100%",
                transition: "background 0.2s"
              }}
            >
              🔄 Reload Application
            </button>

            {this.state.error && (
              <details style={{ marginTop: "24px", textAlign: "left" }}>
                <summary style={{ fontSize: "12px", color: "#9ca3af", cursor: "pointer", outline: "none" }}>
                  Technical Details &amp; Stacktrace
                </summary>
                <pre style={{
                  background: "#0d031f",
                  border: "1px solid #23163a",
                  borderRadius: "8px",
                  padding: "12px",
                  fontSize: "11px",
                  color: "#ef4444",
                  overflowX: "auto",
                  marginTop: "8px",
                  fontFamily: "monospace",
                  maxHeight: "150px"
                }}>
                  {this.state.error.toString()}
                  {"\n"}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
