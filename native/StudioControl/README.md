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
'native/out/Studio Control.app/Contents/MacOS/StudioControl' --snapshot /tmp/studio-control.png /tmp/studio-control-status.json /tmp/studio-control-board.json
```

Ce rendu hors écran est une preuve de mise en page, pas une preuve d’interaction avec la barre de menus. Les actions réelles doivent être qualifiées avec le contrôleur, en conservant les holds existants jusqu’à la réconciliation des anciennes exécutions.

## Périmètre actuel

Le Project et les chemins Studio sont volontairement dédiés à ce Mac. Le contrôleur est relu toutes les 30 secondes et le board au plus toutes les 15 minutes (une heure après erreur). Ce budget persiste après redémarrage et s’applique aussi au bouton Actualiser. Un cache privé conserve le dernier relevé et sa date, les journaux sélectionnés chaque seconde (derniers 128 Ko). Les sources indisponibles sont signalées et empêchent le bouton d’exécution. Les logs peuvent provenir des runs déclarés par le contrôleur ou des archives identifiées par ticket ; aucun texte de ticket n’est exécuté par l’interface.

Le réveil déterministe optionnel se construit depuis le core TypeScript (`scripts/install-studio-wakeup.py`). Cette dépendance n’introduit pas de WebView ou d’Electron dans l’application native.

## Vue d’ensemble

Le Kanban suit six étapes : Prêt, En cours, Relecture, À livrer, En validation store et Terminé. Chaque colonne défile verticalement, le board horizontalement. Un clic conserve l’accès au détail et aux journaux. Idées et À cadrer restent accessibles dans la barre latérale. Le board reflète GitHub ; aucun glisser-déposer ne change implicitement une autorisation d’exécution ou de livraison.

## Mises à jour GitHub

Sparkle 2.10.0 vérifie le flux signé déclaré dans `release.json`. La commande « Rechercher des mises à jour… » figure dans le menu de l’app et le panneau de barre de menus. La recherche est automatique, l’installation reste proposée par Sparkle. Le contrôleur et ses missions tournent dans un processus distinct.

Les archives sont hébergées dans les Releases `studio-control-vVERSION` de `bnjdpn/agent-board`. Le flux est sur la branche dédiée `studio-control-updates`, séparée des releases Electron. La clé privée EdDSA reste dans le trousseau de ce Mac, compte `studio-control` ; seule la clé publique est versionnée. Ne jamais exporter la clé dans le dépôt ou les logs.

Après incrément de `version` et `build` dans `release.json` :

```sh
scripts/release-native.py            # préparer et signer, sans publier
scripts/release-native.py --publish  # source propre, revue et déjà poussée
```

Chaque préparation utilise un nouveau dossier pour empêcher la réutilisation d’un ancien appcast. Le script refuse de remplacer une release existante. Après un échec de publication, inspecter la release et le flux avant toute reprise. Les signatures Sparkle authentifient l’archive et le flux ; elles ne constituent pas une notarisation Apple. Cette distribution personnelle est actuellement signée ad hoc, pour Apple Silicon.

Le service de réveil vérifie l’admission toutes les cinq minutes. Sous suspension, il ne contacte pas GitHub : seules les lectures locales sont faites. Une fois autorisé, le sélecteur existant reste responsable de ses lectures et écritures GitHub ; la limite de la console ne prétend pas couvrir les agents, Grok ou les autres outils.
