<div align="center">

# RTCPortal - Peer-to-Peer File Transfer

## Live Demo

**[RTCPortal](https://dpxa.github.io/RTCPortal/)**

</div>

## Overview

**RTCPortal** is a file-sharing tool that enables direct file transfers between users leveraging **WebRTC**. Unlike cloud storage services, RTCPortal does not store your files on any central server. Instead, files are intended to be sent directly through a **peer-to-peer** (P2P) connection.

A **signaling server** (using **Socket.io**) is necessary for initiating connections. It helps users discover each other and negotiate the P2P connection details (the "handshake"). This signaling server is only involved in this setup process and does not handle or store the files themselves.

To establish the P2P link, **STUN** servers are first utilized to help peers discover their public network addresses. If a direct connection cannot be established (often due to restrictive network configurations), **TURN** servers are then used as a fallback to relay file data between peers. While this ensures connectivity, data relayed via TURN does pass through the TURN server. The TURN server is used only if a direct peer-to-peer connection cannot be established.

## How to Use

1. **Get Your Unique ID:** When you open RTCPortal, a unique ID is automatically generated and displayed for you. Click the "Copy" button next to your ID.
2. **Share Your ID:** Send this copied ID to the person you want to share files with.
3. **Get Their ID:** Ask the other person for their RTCPortal ID.
4. **Connect to Your Peer:** Enter their ID to establish a connection.
5. **Transfer Files:** Once the connection is established, you can select and send files directly to your peer.

## Tech Stack

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js, Express, Socket.IO
- **Communication and Hosting:** WebRTC, GitHub Pages (Frontend) + Render (Backend)

## Credits

- **TURN Server:** [Open Relay Project](https://www.metered.ca/tools/openrelay/) – Free TURN server provided by Metered.ca, used only if a direct peer-to-peer connection cannot be established.

## License

See the [LICENSE](LICENSE) file for details.

## Contact

For questions or support, please open an issue.
