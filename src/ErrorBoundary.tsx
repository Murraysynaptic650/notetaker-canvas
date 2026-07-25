import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  componentStack: string | null
}

/**
 * Renders any React render-phase error as visible text instead of a white
 * screen. Essential on iPad, where the browser console is only reachable via
 * Mac Safari Web Inspector.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, componentStack: info.componentStack ?? null })
  }

  render(): ReactNode {
    const { error, componentStack } = this.state
    if (!error) return this.props.children

    return (
      <div
        style={{
          font: '14px/1.5 ui-monospace, Menlo, monospace',
          padding: 24,
          color: '#111',
          background: '#fff',
          height: '100%',
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
        }}
      >
        <strong style={{ color: '#c00', fontSize: 16 }}>Render error</strong>
        {'\n\n'}
        {error.stack ?? `${error.name}: ${error.message}`}
        {componentStack ? `\n\nComponent stack:${componentStack}` : ''}
      </div>
    )
  }
}
