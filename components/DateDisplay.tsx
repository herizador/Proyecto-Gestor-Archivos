'use client'

export default function DateDisplay({ date }: { date: string | Date }) {
  return <span suppressHydrationWarning>{new Date(date).toLocaleDateString()}</span>
}
