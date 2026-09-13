import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { hasError: boolean; message: string }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };
  static getDerivedStateFromError(error: Error): State { return { hasError: true, message: error.message }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Application error', error, info); }
  render() {
    if (!this.state.hasError) return this.props.children;
    return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:24,fontFamily:'system-ui',background:'#f5f7fb'}}>
      <section style={{maxWidth:520,background:'#fff',border:'1px solid #e4e9f0',borderRadius:16,padding:24,boxShadow:'0 15px 45px rgba(16,27,46,.08)'}}>
        <strong style={{fontSize:18,color:'#14233b'}}>Something went wrong</strong>
        <p style={{color:'#6f7e94',lineHeight:1.6}}>Your saved local data is preserved. Reload the application and try again. If this keeps happening, use the support diagnostics from the settings area.</p>
        <button onClick={()=>location.reload()} style={{padding:'10px 14px',border:0,borderRadius:9,background:'#14233b',color:'#fff',fontWeight:700}}>Reload</button>
        <details style={{marginTop:14,color:'#8a96a8',fontSize:11}}><summary>Technical detail</summary><pre style={{whiteSpace:'pre-wrap'}}>{this.state.message}</pre></details>
      </section>
    </main>;
  }
}
