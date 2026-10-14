# Studio Control — macOS

Console native SwiftUI dédiée au Studio de Benjamin. macOS 14 ou ultérieur.

- Barre de menus : état réel du contrôleur, missions actives, pause et reprise.
- Fenêtre : colonnes du Project GitHub, recherche, détail des missions et journaux locaux.
- Pause interdit les nouveaux départs. Arrêter interrompt les missions reconnues par le contrôleur. Reprendre réconcilie l’état sans effacer les suspensions de sécurité.
- Les commandes passent exclusivement par `~/.local/bin/studio`. La console ne possède ni file de dispatch ni politique de livraison. Studio CEO décide des lots.
- Fermer la fenêtre ou quitter l’interface n’arrête pas les missions. Le réveil automatique est un service distinct, dont la présence et la fraîcheur sont affichées.

## Construire

Depuis la racine du dépôt :

```sh
swift test --package-path native/StudioControl
scripts/build-native.sh
```

Le paquet signé localement est produit dans `native/out/Studio Control.app`. La construction ne lance pas l’application et n’installe aucun service. L’interface utilise l’authentification existante de GitHub CLI ; elle ne contient pas de secret.

## Vérification sans ouverture de fenêtre

```sh
studio status --json > /tmp/studio-control-status.json
gh project item-list 1 --owner bnjdpn --limit 1000 --format json > /tmp/studio-control-board.json
native/StudioControl/.build/release/StudioControl --snapshot /tmp/studio-control.png /tmp/studio-control-status.json /tmp/studio-control-board.json
```

Ce rendu hors écran est une preuve de mise en page, pas une preuve d’interaction avec la barre de menus. Les actions réelles doivent être qualifiées avec le contrôleur, en conservant les holds existants jusqu’à la réconciliation des anciennes exécutions.

## Périmètre actuel

Le Project et les chemins Studio sont volontairement dédiés à ce Mac. Le board est relu toutes les 30 secondes, les journaux sélectionnés chaque seconde (derniers 128 Ko). Les sources indisponibles sont signalées et empêchent le bouton d’exécution. Les logs peuvent provenir des runs déclarés par le contrôleur ou des archives identifiées par ticket ; aucun texte de ticket n’est exécuté par l’interface.

Le réveil déterministe optionnel se construit depuis le core TypeScript (`scripts/install-studio-wakeup.py`). Cette dépendance n’introduit pas de WebView ou d’Electron dans l’application native.
