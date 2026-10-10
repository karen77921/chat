import { Component } from 'react';

/** Last-resort recovery for iOS Safari/runtime failures: never leave a blank page. */
export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) {
    console.error('Imprint UI crashed', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-recovery" role="alert">
        <div className="app-recovery-card">
          <div className="app-recovery-mark">IMPRINT</div>
          <h1>页面刚刚卡住了</h1>
          <p>聊天记录没有丢失。刷新后会从后端重新载入。</p>
          <button type="button" onClick={() => window.location.reload()}>重新打开</button>
        </div>
      </main>
    );
  }
}
