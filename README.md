# Pixelwars

A four-team paint fight on a maze that is rebuilt every round, for Decentraland SDK 7.

You pick red, blue, green, or yellow in the lobby. Walking paints the floor. Dash (E) and Burst (F) paint and knock. The team with the most paint when the three-minute round ends wins, and the next maze is a new layout.

Design: [`design/gdd.md`](design/gdd.md). Older plans and handoffs: [`archive/`](archive/README.md).

**World:** [pixelwars.dcl.eth](https://play.decentraland.org/?realm=pixelwars.dcl.eth)

The scene is meant to be downloaded and remixed. Blender and SketchUp sources sit next to the exported tile models in `assets/`.

## Run locally

```bash
npm install
npm start
```

Rebuild in Creator Hub before you preview. The owner deploys.

## License

MIT — do whatever you like, credit appreciated but not required.
