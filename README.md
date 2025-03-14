# RTCPortal - Peer-to-Peer File Sharing

## Live Demo  
**[RTCPortal](https://dpxa.github.io/RTCPortal/)**

## Overview ##

**RTCPortal** is a web-based file-sharing tool that enables direct file transfers using **WebRTC**. Unlike cloud storage services, it doesn't store files on a central server. Instead, files are sent **peer-to-peer**, providing **privacy and efficiency**.  

A **signaling server** using **Socket.io** helps users connect but is only involved in the initial handshake - it does not store or handle file transfers. Once connected, files are exchanged directly.

## ✨ Features  
- Secure **peer-to-peer file sharing** using WebRTC  
- No need for an account or installation  
- Transfers files **directly between users**, avoiding cloud storage  
- Simple and intuitive interface  

## How to Use  
1. **Copy Your ID:** A unique ID is generated automatically  
2. **Share Your ID:** Send it to the person you want to connect with  
3. **Enter Their ID:** Type their ID and click "Connect"  
4. **Start Transferring Files:** Once connected, share files directly  

## Tech Stack  
- **Frontend:** HTML, CSS, JavaScript  
- **Backend:** Node.js, Express, Socket.IO  
- **Real-Time Communication:** WebRTC  
- **Hosting:** GitHub Pages (Frontend) + Render (Backend)  

## Planned
- **TURN server support** to improve connectivity in restricted networks
- **Drag-and-drop file sharing** for an even smoother process

## License  
See the [LICENSE](LICENSE) file for details.  
