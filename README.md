# RTCPortal - P2P File Sharing via WebRTC  

RTCPortal is a web-based file-sharing tool that allows users to send files directly to each other using WebRTC and Socket.IO. Unlike cloud storage services, RTCPortal does not store files on a central server. Instead, files are transferred directly between users, making the process private and efficient.  

---

## Live Demo  

🔗 **[RTCPortal](https://yourusername.github.io/RTCPortal/)**

---

## Features  
- Peer-to-peer file sharing with WebRTC  
- No account or installation required  
- Direct file transfer between users, no cloud storage  
- Simple and easy-to-use interface  

---

## How It Works  
1. Open the website: [RTCPortal](https://yourusername.github.io/RTCPortal/)  
2. Copy the unique ID displayed on your screen  
3. Share your ID with the person you want to connect with  
4. Enter their ID in the input box and click "Connect"  
5. Once connected, send and receive files directly  

---

## Tech Stack
- **Frontend:** HTML, CSS, JavaScript  
- **Backend:** Node.js, Express, Socket.IO  
- **Communication:** WebRTC for peer-to-peer file transfer
- **Hosting:** GitHub Pages + Render

---

## How RTCPortal Works
RTCPortal uses a signaling server (hosted on Render) to help users find and connect with each other. The signaling server is only used during the connection process. Once a connection is established, files are transferred directly between users through WebRTC. The signaling server does not handle or store any files.  

---

## Planned Improvements  
- **TURN server support** for better connectivity behind firewalls
- **Drag-and-drop file sharing** for a smoother user experience  

---

## License  
This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.  
