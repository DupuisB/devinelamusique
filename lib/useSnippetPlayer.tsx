import { useEffect, useRef, useState } from 'react'

export default function useSnippetPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const onTimeHandlerRef = useRef<((e: Event) => void) | null>(null)
  const [playhead, setPlayhead] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        try { audioRef.current.pause() } catch {}
      }
    }
  }, [])

  function attachAudio(el: HTMLAudioElement | null) {
    audioRef.current = el
  }

  async function playSnippet(src: string, duration: number) {
    const audio = audioRef.current
    if (!audio) return
    // If currently playing, pause
    if (!audio.paused) {
      audio.pause()
      setIsPlaying(false)
      return
    }
    if (audio.src !== src) {
      audio.src = src
      try { audio.load() } catch {}
    }
    try { audio.currentTime = 0 } catch {}
    setPlayhead(0)
    if (onTimeHandlerRef.current) audio.removeEventListener('timeupdate', onTimeHandlerRef.current)
    const onTime = () => {
      const t = Math.min(audio.currentTime, duration)
      setPlayhead(t)
      if (t >= duration) {
        audio.pause()
        audio.removeEventListener('timeupdate', onTime)
        onTimeHandlerRef.current = null
        setIsPlaying(false)
      }
    }
    onTimeHandlerRef.current = onTime
    audio.addEventListener('timeupdate', onTime)
    try { await audio.play(); setIsPlaying(true) } catch { setIsPlaying(false) }
  }

  function pause() {
    const audio = audioRef.current
    if (!audio) return
    try { audio.pause() } catch {}
    setIsPlaying(false)
  }

  return { audioRef, attachAudio, playSnippet, pause, playhead, isPlaying }
}
