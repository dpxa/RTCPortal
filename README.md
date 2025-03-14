# RTCPortal – Peer-to-Peer File Sharing via WebRTC  

RTCPortal is a web-based file-sharing tool that enables users to send files directly to each other using WebRTC and Socket.IO. Unlike traditional cloud storage services, RTCPortal does not store files on a central server. Instead, files are transferred directly between users, ensuring privacy and efficiency.  

## Live Demo  
🔗 **[RTCPortal](https://yourusername.github.io/RTCPortal/)**  

## ✨ Features  
- Secure **peer-to-peer file sharing** using WebRTC  
- No need for an account or installation  
- Transfers files **directly between users**, avoiding cloud storage  
- Simple and intuitive interface  

## How to Use  
1. **Open RTCPortal:** [RTCPortal](https://yourusername.github.io/RTCPortal/)  
2. **Copy Your ID:** A unique ID is generated automatically  
3. **Share Your ID:** Send it to the person you want to connect with  
4. **Enter Their ID:** Type their ID and click "Connect"  
5. **Start Transferring Files:** Once connected, share files directly  

## Tech Stack  
- **Frontend:** HTML, CSS, JavaScript  
- **Backend:** Node.js, Express, Socket.IO  
- **Real-Time Communication:** WebRTC  
- **Hosting:** GitHub Pages (Frontend) + Render (Backend)  

## How RTCPortal Works  
RTCPortal uses a **signaling server** (hosted on Render) to help users discover and connect with each other. This server is only involved in the **initial connection phase** and does not handle or store any file transfers. Once the WebRTC connection is established, files are exchanged **directly between users** for a fast and private sharing experience.  

## Planned Improvements  
- **TURN server support** to enhance connectivity in restricted networks  
- **Drag-and-drop file sharing** for a more seamless experience  

## License  
This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.  
