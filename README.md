<div align="center">

# RTCPortal - Peer-to-Peer File Sharing

## Live Demo  
**[RTCPortal](https://dpxa.github.io/RTCPortal/)**

</div>

## Overview  

**RTCPortal** is a web-based file-sharing tool that enables direct file transfers using **WebRTC**. Unlike cloud storage services, it doesn't store files on a central server. Instead, files are sent through a private **peer-to-peer** connection.

A **signaling server** using **Socket.io** helps users connect but is only involved in the initial handshake - it does not store or handle file transfers. Once connected, files are exchanged directly.

## How to Use  
1. **Copy Your ID:** A unique ID is generated automatically  
2. **Share Your ID:** Send it to the person you want to connect with  
3. **Enter Their ID:** Type their ID and click "Connect"  
4. **Start Transferring Files:** Once connected, share files directly  

## Tech Stack  
- **Frontend:** HTML, CSS, JavaScript  
- **Backend:** Node.js, Express, Socket.IO  
- **Communication and Hosting:** WebRTC, GitHub Pages (Frontend) + Render (Backend)  

## WIP
- **TURN server support**: Improve connectivity in restricted networks  
- **Drag-and-drop file sharing**

## License  
See the [LICENSE](LICENSE) file for details.  
