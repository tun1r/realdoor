import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:realdoor-test'
}

if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = () => undefined
}

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => null,
})
