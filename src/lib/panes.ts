import { useCallback, useEffect, useState } from 'react'

const KEY_PREFIX = 'readingapp.pane.'

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi)
}

function readPane(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + key)
    if (raw === null) return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function writePane(key: string, value: number): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + key, String(value))
  } catch {
    // 저장이 막힌 브라우저에서도 이번 세션 동안은 그대로 쓴다
  }
}

/**
 * 끄는 동안에는 값만 바꾸고, 손을 뗄 때(commit) 기기에 남긴다.
 * 문서와 함께 옮길 값이 아니라 이 브라우저의 보기 취향이라 localStorage 를 쓴다.
 */
export function usePaneSize(key: string, fallback: number) {
  const [size, setSize] = useState(() => readPane(key) ?? fallback)
  const commit = useCallback(
    (value: number) => {
      setSize(value)
      writePane(key, value)
    },
    [key],
  )
  return [size, setSize, commit] as const
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}
