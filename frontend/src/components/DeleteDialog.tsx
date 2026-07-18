import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, LoaderCircle, Trash2, X } from 'lucide-react'

interface DeleteDialogProps {
  onClose: () => void
  onConfirm: () => Promise<void>
}

function focusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  )
}

export function DeleteDialog({ onClose, onConfirm }: DeleteDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState('')

  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const elements = focusableElements(dialogRef.current)
      if (elements.length === 0) {
        event.preventDefault()
        dialogRef.current.focus()
        return
      }
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, pending])

  const confirm = async () => {
    setPending(true)
    setFailure('')
    try {
      await onConfirm()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'The session could not be deleted. Try again.')
      setPending(false)
    }
  }

  return (
    <>
      <button type="button" className="dialog-backdrop" aria-label="Close delete dialog" onClick={onClose} disabled={pending} />
      <div className="dialog-wrap">
        <div
          ref={dialogRef}
          className="confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-title"
          aria-describedby="delete-description"
        >
          <div className="dialog-header">
            <div className="dialog-icon dialog-icon--danger" aria-hidden="true">
              <AlertTriangle size={22} />
            </div>
            <div>
              <span className="eyebrow">Delete session</span>
              <h2 id="delete-title">Remove this evidence desk?</h2>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              className="icon-button"
              onClick={onClose}
              disabled={pending}
              aria-label="Close delete dialog"
              title="Close delete dialog"
            >
              <X aria-hidden="true" size={21} />
            </button>
          </div>
          <p id="delete-description" className="dialog-copy">
            This action cannot be undone. Exactly these items will be removed:
          </p>
          <ul className="delete-list">
            <li>Session record and timestamps</li>
            <li>Uploaded document files and page previews</li>
            <li>Extracted fields, confirmations, and corrections</li>
            <li>Packet selections and renter note</li>
          </ul>
          {failure ? (
            <p className="inline-error" role="alert">
              {failure}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button type="button" className="button button--secondary" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button type="button" className="button button--danger" onClick={() => void confirm()} disabled={pending}>
              {pending ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : <Trash2 aria-hidden="true" size={18} />}
              {pending ? 'Deleting session' : 'Delete session'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
