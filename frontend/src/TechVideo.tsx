import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  BadgeCheck,
  Calculator,
  Check,
  Crosshair,
  EyeOff,
  FileText,
  Pause,
  Play,
  RefreshCcw,
  ScanLine,
  ShieldCheck,
  UserCheck,
} from 'lucide-react'

const TOTAL_SECONDS = 58

const chapters = [
  { at: 0, label: 'Untrusted input' },
  { at: 7, label: 'Local extraction' },
  { at: 13, label: 'Cited evidence' },
  { at: 19, label: 'Renter control' },
  { at: 26, label: 'Deterministic rules' },
  { at: 33, label: 'Safe replacement' },
  { at: 50, label: 'Human review' },
]

interface TimedItem {
  at: number
  title: string
  detail: string
  icon: ReactNode
  tone: 'source' | 'confirm' | 'rules' | 'review'
}

const pipeline: TimedItem[] = [
  {
    at: 0,
    title: 'Untrusted PDFs',
    detail: 'Session-isolated input',
    icon: <FileText aria-hidden="true" />,
    tone: 'review',
  },
  {
    at: 7,
    title: 'Local extraction',
    detail: 'PyMuPDF + Tesseract OCR',
    icon: <ScanLine aria-hidden="true" />,
    tone: 'source',
  },
  {
    at: 13,
    title: 'Cited evidence',
    detail: 'Value · page · source box',
    icon: <Crosshair aria-hidden="true" />,
    tone: 'source',
  },
  {
    at: 19,
    title: 'Renter confirms',
    detail: 'Review · correct · confirm',
    icon: <UserCheck aria-hidden="true" />,
    tone: 'confirm',
  },
  {
    at: 26,
    title: 'Deterministic rules',
    detail: 'Income · freshness · conflicts',
    icon: <Calculator aria-hidden="true" />,
    tone: 'rules',
  },
  {
    at: 50,
    title: 'Human review',
    detail: 'No program decision',
    icon: <BadgeCheck aria-hidden="true" />,
    tone: 'confirm',
  },
]

const replacement: TimedItem[] = [
  {
    at: 33,
    title: 'Structured blocker',
    detail: 'Exact document + field',
    icon: <Crosshair aria-hidden="true" />,
    tone: 'review',
  },
  {
    at: 36,
    title: 'Local validation',
    detail: 'Identity + source continuity',
    icon: <ShieldCheck aria-hidden="true" />,
    tone: 'source',
  },
  {
    at: 39,
    title: 'Pending evidence',
    detail: 'Outside canonical arithmetic',
    icon: <Pause aria-hidden="true" />,
    tone: 'rules',
  },
  {
    at: 42,
    title: 'Renter confirms',
    detail: 'Explicit promotion gate',
    icon: <UserCheck aria-hidden="true" />,
    tone: 'confirm',
  },
  {
    at: 45,
    title: 'Lifecycle preserved',
    detail: 'New active · old superseded',
    icon: <RefreshCcw aria-hidden="true" />,
    tone: 'confirm',
  },
  {
    at: 48,
    title: 'Atomic reanalysis',
    detail: 'Readiness recalculated',
    icon: <Check aria-hidden="true" />,
    tone: 'confirm',
  },
]

function itemState(elapsed: number, at: number) {
  if (elapsed < at) return 'waiting'
  if (elapsed < at + 3.5) return 'current'
  return 'complete'
}

function connectorFill(elapsed: number, at: number) {
  return Math.max(0, Math.min(1, (elapsed - at) / 1.5))
}

function TimedNode({ item, elapsed, compact = false }: { item: TimedItem; elapsed: number; compact?: boolean }) {
  return (
    <article className={`tech-node tech-node--${item.tone} tech-node--${itemState(elapsed, item.at)} ${compact ? 'tech-node--compact' : ''}`}>
      <span className="tech-node__index" aria-hidden="true">
        {elapsed >= item.at + 3.5 ? <Check size={14} /> : String(item.at).padStart(2, '0')}
      </span>
      <span className="tech-node__icon">{item.icon}</span>
      <h2>{item.title}</h2>
      <p>{item.detail}</p>
    </article>
  )
}

function Connector({ elapsed, at, compact = false }: { elapsed: number; at: number; compact?: boolean }) {
  const style = { '--connector-fill': connectorFill(elapsed, at) } as CSSProperties
  return <span className={`tech-connector ${compact ? 'tech-connector--compact' : ''}`} style={style} aria-hidden="true" />
}

export function TechVideo() {
  const query = new URLSearchParams(window.location.search)
  const recordMode = query.get('record') === '1'
  const finalMode = query.get('final') === '1'
  const requestedTime = Number(query.get('time'))
  const previewTime = Number.isFinite(requestedTime) && query.has('time')
    ? Math.max(0, Math.min(TOTAL_SECONDS, requestedTime))
    : null
  const [elapsed, setElapsed] = useState(finalMode ? TOTAL_SECONDS : previewTime ?? 0)
  const [playing, setPlaying] = useState(recordMode && !finalMode && previewTime === null)
  const [controlsVisible, setControlsVisible] = useState(!recordMode)
  const startedAt = useRef<number | null>(null)
  const frame = useRef<number | null>(null)
  const elapsedRef = useRef(elapsed)

  const restart = () => {
    startedAt.current = performance.now()
    setElapsed(0)
    setPlaying(true)
  }

  useEffect(() => {
    elapsedRef.current = elapsed
  }, [elapsed])

  useEffect(() => {
    if (!playing) {
      startedAt.current = null
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      return
    }

    const tick = (now: number) => {
      if (startedAt.current === null) startedAt.current = now - elapsedRef.current * 1000
      const next = Math.min(TOTAL_SECONDS, (now - startedAt.current) / 1000)
      setElapsed(next)
      if (next >= TOTAL_SECONDS) {
        setPlaying(false)
        return
      }
      frame.current = requestAnimationFrame(tick)
    }

    frame.current = requestAnimationFrame(tick)
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [playing])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        event.preventDefault()
        if (elapsed >= TOTAL_SECONDS) restart()
        else setPlaying((value) => !value)
      }
      if (event.key.toLowerCase() === 'r') restart()
      if (event.key.toLowerCase() === 'c') setControlsVisible((value) => !value)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [elapsed])

  const currentChapter = [...chapters].reverse().find((chapter) => elapsed >= chapter.at) ?? chapters[0]
  const pipelineVisible = elapsed < 33 || elapsed >= 48
  const replacementVisible = elapsed >= 31

  return (
    <main className="tech-video-page">
      <section className="tech-canvas" aria-label="RealDoor technical architecture animation">
        <header className="tech-header">
          <div className="tech-wordmark" aria-label="RealDoor">
            <span>Real</span><strong>Door</strong>
          </div>
          <div className="tech-heading">
            <p className="tech-eyebrow">Evidence architecture · frozen 2026 rules</p>
            <h1>From untrusted documents to review-ready evidence</h1>
          </div>
          <div className="tech-chapter" aria-live="polite">
            <span>{String(Math.min(59, Math.floor(elapsed))).padStart(2, '0')}s</span>
            <strong>{currentChapter.label}</strong>
          </div>
        </header>

        <section className={`tech-pipeline ${pipelineVisible ? 'tech-section--visible' : 'tech-section--quiet'}`} aria-label="Primary evidence pipeline">
          <div className={`hosted-branch ${elapsed >= 8 ? 'hosted-branch--visible' : ''}`}>
            <span>Hosted vision fallback</span>
            <small>Explicit opt-in · unresolved fields only</small>
          </div>
          {pipeline.map((item, index) => (
            <div className="tech-flow-item" key={item.title}>
              <TimedNode item={item} elapsed={elapsed} />
              {index < pipeline.length - 1 ? <Connector elapsed={elapsed} at={pipeline[index + 1].at - 1.5} /> : null}
            </div>
          ))}
          <div className={`formula-readout ${elapsed >= 26 ? 'formula-readout--visible' : ''}`}>
            <span>Confirmed arithmetic</span>
            <strong>$26 × 34 × 52 = $45,968</strong>
            <small>Frozen five-person threshold · $111,120</small>
          </div>
        </section>

        <section className={`replacement-band ${replacementVisible ? 'replacement-band--visible' : ''}`} aria-label="Replacement evidence lifecycle">
          <div className="replacement-band__heading">
            <div>
              <span className="tech-eyebrow">One blocker, one clear fix</span>
              <h2>Targeted replacement without silent mutation</h2>
            </div>
            <p>Pending evidence cannot change readiness until the renter confirms it.</p>
          </div>
          <div className="replacement-flow">
            {replacement.map((item, index) => (
              <div className="replacement-flow__item" key={item.title}>
                <TimedNode item={item} elapsed={elapsed} compact />
                {index < replacement.length - 1 ? <Connector elapsed={elapsed} at={replacement[index + 1].at - 1.2} compact /> : null}
              </div>
            ))}
          </div>
        </section>

        <section className={`trust-rail ${elapsed >= 49 ? 'trust-rail--visible' : ''}`} aria-label="Trust boundaries">
          <div>
            <ShieldCheck aria-hidden="true" />
            <span><strong>Local by default</strong><small>Hosted vision requires explicit opt-in</small></span>
          </div>
          <div>
            <Crosshair aria-hidden="true" />
            <span><strong>Citations required</strong><small>Page and source box for every local value</small></span>
          </div>
          <div>
            <Calculator aria-hidden="true" />
            <span><strong>Canonical readiness</strong><small>Packet selection cannot improve status</small></span>
          </div>
          <div>
            <RefreshCcw aria-hidden="true" />
            <span><strong>Complete deletion</strong><small>Active, pending and superseded evidence</small></span>
          </div>
        </section>

        <footer className={`tech-footer ${elapsed >= 50 ? 'tech-footer--visible' : ''}`}>
          <div className="verification-strip" aria-label="Verification evidence">
            <span><strong>63</strong> backend tests</span>
            <span><strong>18</strong> accessibility tests</span>
            <span><strong>3</strong> browser journeys</span>
          </div>
          <div className="boundary-statement">
            <ShieldCheck aria-hidden="true" />
            <span>Evidence prepared.</span>
            <strong>Decision preserved.</strong>
          </div>
        </footer>

        <div className="tech-progress" aria-hidden="true">
          <span style={{ width: `${(elapsed / TOTAL_SECONDS) * 100}%` }} />
        </div>
      </section>

      {controlsVisible ? (
        <nav className="tech-controls" aria-label="Animation controls">
          <button type="button" onClick={() => elapsed >= TOTAL_SECONDS ? restart() : setPlaying((value) => !value)} title={playing ? 'Pause animation' : 'Play animation'}>
            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            <span>{playing ? 'Pause' : 'Play'}</span>
          </button>
          <button type="button" onClick={restart} title="Restart animation">
            <RefreshCcw aria-hidden="true" />
            <span>Restart</span>
          </button>
          <button type="button" onClick={() => setControlsVisible(false)} title="Hide recording controls">
            <EyeOff aria-hidden="true" />
            <span>Hide controls</span>
          </button>
        </nav>
      ) : null}
    </main>
  )
}
