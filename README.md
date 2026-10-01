# Chooser — Live Camera

A static web app that randomly highlights a person directly in the live camera feed. The video continues playing throughout selection, and the winner remains highlighted while tracking is confident.

## Publish with GitHub Pages

1. Create a new GitHub repository, for example `chooser-live-camera`. GitHub Free requires a public repository for Pages. A supported paid plan can host Pages from a private repository; the website itself is normally public.
2. Upload all files from this folder to the repository root on `main`, keeping the `vendor` directory and `.nojekyll` file. Upload the extracted files, not the ZIP. `index.html` should sit directly in the repository root.
3. Open the repository's **Settings → Pages**. Set **Source** to **Deploy from a branch**, choose **main**, select **/(root)**, and save.
4. Once GitHub finishes deployment, use **Visit site** on that same Pages settings screen. Open the HTTPS site and allow camera access when you tap **Enable camera**.

No build command, package installation, API key, or backend is needed. Local assets use relative URLs, so the app works under a GitHub project path such as `/chooser-live-camera/`.

Official instructions: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## Camera behavior

The highlight cycles directly over detected faces, then chooses one with equal probability. New arrivals join the next round; a lost or ambiguous track cancels the current round. The selected track is never intentionally transferred to a newcomer. Geometry-based tracking is not identity recognition: keep faces clear and avoid crossing during selection.

If automatic detection is unavailable, manual markers work as fixed spots on the live video. They do not follow movement.

Camera images are processed locally in your browser and are not uploaded or saved. Camera support requires HTTPS or localhost. For the best supported experience, use Chrome or Safari.

## Included assets

The local `vendor` folder contains MediaPipe Tasks Vision 0.10.21, both WASM variants, the BlazeFace short-range model, its license, and an asset source/hash manifest. Keep this folder intact. Typography uses Google Fonts with system-font fallbacks.
