import React from 'react'

export const metadata = {
  title: 'Devine la Musique',
  description: 'Jeu: devine le morceau français à partir d\'un extrait.'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body style={{
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        background: '#111', color: '#eee', margin: 0
      }}>
        {children}
      </body>
    </html>
  )
}
