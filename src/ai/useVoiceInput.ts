import { useCallback, useEffect, useRef, useState } from 'react'

export interface VoiceInputOptions {
  /** Live partial transcript, updated as the user speaks. */
  onInterim?: (text: string) => void
  /** Final transcript for a phrase, once speech settles. */
  onFinal: (text: string) => void
}

export interface VoiceInput {
  supported: boolean
  listening: boolean
  toggle: () => void
}

/**
 * Thin wrapper over the browser's Web Speech API (SpeechRecognition) so the
 * user can talk to the study partner instead of typing. Interim results feed
 * the input box live; final results are sent up via `onFinal`.
 */
export function useVoiceInput({ onInterim, onFinal }: VoiceInputOptions): VoiceInput {
  const Recognition = getRecognitionCtor()
  const supported = Boolean(Recognition)

  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const onInterimRef = useRef(onInterim)
  const onFinalRef = useRef(onFinal)
  onInterimRef.current = onInterim
  onFinalRef.current = onFinal

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const start = useCallback(() => {
    if (!Recognition) return

    const recognition = new Recognition()
    recognition.lang = 'en-US'
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const transcript = result[0]?.transcript ?? ''
        if (result.isFinal) {
          const finalText = transcript.trim()
          if (finalText) onFinalRef.current(finalText)
        } else {
          interim += transcript
        }
      }
      if (interim) onInterimRef.current?.(interim)
    }

    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)

    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }, [Recognition])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  // Clean up any active session on unmount.
  useEffect(() => () => recognitionRef.current?.stop(), [])

  return { supported, listening, toggle }
}

// --- Minimal typings for the vendor-prefixed, non-standard-typed API ---

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: (event: SpeechRecognitionEventLike) => void
  onerror: () => void
  onend: () => void
  start: () => void
  stop: () => void
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

type RecognitionCtor = new () => SpeechRecognitionLike

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}
