# Devine la Musique

Un jeu type "Guess the audio" spécialisé musique FR: écoute un extrait, saisis ta proposition, et découvre des indices à chaque essai.

Fonctionnalités clés
- Jeu quotidien (Wordle-like) avec # du jour et navigation jours précédents/suivants
- FR/EN toggle, progression sauvegardée localement par jour et langue
- Suggestions via recherche Deezer (pas de cache local pour éviter les spoilers)
- Extrait audio à durée croissante par tentative (configurable dans `lib/config.ts`)
- Indices: durée → année → album → artiste

Techniques
- Next.js 14 (App Router), TypeScript, SWR
- API routes `/api/daily`, `/api/search`, `/api/songs`
- Config centralisée dans `lib/config.ts` (date de départ, playlists FR/EN, durées des extraits)

Développement
- Démarrage: `npm run dev` puis ouvrir http://localhost:3000
- Build: `npm run build`, Prod: `npm run start`

Notes
- Deezer retourne des previews de 30s; on tronque côté client selon la tentative.
- Ce projet est une démo; vérifiez les conditions d'utilisation de Deezer.

- Faire gaffe aux années / genres (les vieilles musiques sont dans des compils de genre et d'année différente de la vraie)