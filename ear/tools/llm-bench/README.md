# Banc d'essai d'un LLM local

Mesure si un modèle tournant sur la carte graphique de la VM de l'oreille peut
remplacer le modèle distant pour la voix : 20 demandes typiques (ordres,
état de la maison, contacts, rappels, recherche web, questions générales),
avec une maison fictive. Rien ne sort de la machine et rien n'est modifié dans
igor-ear ni whisper-server.

```
bash setup.sh   # compile llama.cpp (Vulkan) et télécharge 3 modèles dans ~/igor-bench
bash run.sh     # les essaie l'un après l'autre sur 127.0.0.1:8180
```

Chaque ligne dit `OK` ou `RATÉ`, le temps et ce que le modèle a fait ; la
ligne `RÉSUMÉ` donne le score, le temps médian, la vitesse et la mémoire
graphique utilisée. Pour tout enlever : `rm -rf ~/igor-bench ~/llama.cpp`.
