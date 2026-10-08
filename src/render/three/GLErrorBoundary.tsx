// Catches anything the GL canvas throws (WebGL context creation failure,
// shader compile errors, a throw inside the frame loop) so a GPU problem
// can never blank the whole app. It renders nothing and reports the error;
// the renderer status then switches the board to the 2D renderer.

import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  onError: (error: unknown) => void;
}

export class GLErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.warn("[bomb-shooter] 3D renderer failed, switching to 2D", error, info.componentStack);
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
