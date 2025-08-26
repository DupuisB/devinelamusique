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

Déploiement sur Render
- Ce repo contient un fichier `render.yaml` pour un déploiement 1‑clic.
- Étapes:
	1. Poussez votre code sur GitHub.
	2. Sur Render, créez un Blueprint (New + Blueprint) et pointez vers ce repo.
	3. Render détecte `render.yaml`, exécute `npm ci && npm run build`, puis `npm start`.
	4. L’app sera disponible à l’URL Render. Modifiez `lib/config.ts` si besoin puis redeploy.

Notes
- Deezer retourne des previews de 30s; on tronque côté client selon la tentative.
- Ce projet est une démo; vérifiez les conditions d'utilisation de Deezer.

- Faire gaffe aux années / genres (les vieilles musiques sont dans des compils de genre et d'année différente de la vraie)