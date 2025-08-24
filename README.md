# Devine la Musique (Prototype)

Un jeu type "Guess the audio" spécialisé musique FR: écoute un extrait, saisis ta proposition, et découvre des indices à chaque essai.

Fonctionnalités clés
- Extrait réécoutable, longueur qui augmente après chaque erreur (1,2,4,7,10,15s)
- Jusqu'à 6 essais, auto-complétion (Fuse.js) titre/artiste
- Indices progressifs: durée → année → genre → album → artiste
- Filtres: genre (rap, pop, electro, rock) et langue (fr, en)
- Données dynamiques depuis Deezer (charts France + tops genre) avec previews 30s
- Responsive, style minimal inspiré Wordle

Technique
- Next.js 14 (App Router), TypeScript, SWR, Fuse.js
- API route `/api/songs` qui agrège Deezer et enrichit année/genre via les albums

Développement
- Démarrage: `npm run dev` puis ouvrir http://localhost:3000
- Build: `npm run build`, Prod: `npm run start`

Notes
- Deezer retourne des previews de 30s; on tronque côté client selon la tentative.
- Le mapping des genres est simple et peut être amélioré.
- Ce projet est une démo; vérifiez les conditions d'utilisation de Deezer.
