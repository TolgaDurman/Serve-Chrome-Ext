import { injectBmcButton } from './bmcButton.js';

// Global directory handle that we can reference
let globalDirectoryHandle = null;

// Try to load last used directory handle from storage
async function loadLastDirectoryHandle() {
    if ('storage' in navigator && 'getDirectory' in navigator.storage) {
        try {
            const dirHandle = await navigator.storage.getDirectory();
            if (dirHandle) {
                globalDirectoryHandle = dirHandle;
                return true;
            }
        } catch (e) {
            // Ignore if not available
        }
    }
    return false;
}

// Save directory handle for later use (if supported)
async function saveDirectoryHandle(dirHandle) {
    // This is a placeholder for future implementation (e.g., using IndexedDB)
    // Chrome's File System Access API does not yet allow persistent storage of directory handles without user interaction
}

// Status message handler
function showStatus(message, isError = false) {
    const status = document.getElementById('status');
    const button = document.getElementById('select-folder');
    const playButton = document.getElementById('play-button');
    
    if (message === 'loading') {
        button.innerHTML = '<div class="loading"></div> Loading...';
        button.disabled = true;
        status.style.display = 'none';
    } else {
        button.innerHTML = `
            <svg class="icon" viewBox="0 0 24 24">
                <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
            </svg>
            Select WebGL Folder
        `;
        button.disabled = false;
        
        if (message) {
            status.textContent = message;
            status.style.display = 'block';
            status.className = 'status ' + (isError ? 'error' : 'success');
        } else {
            status.style.display = 'none';
        }
    }
}

// Register this tab as having file access
function registerAsFileAccessTab() {
    chrome.runtime.sendMessage({
        action: 'registerFileAccessTab'
    });
}

// Check if a directory contains index.html
async function checkForIndexHtml(dirHandle, path = '') {
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase() === 'index.html') {
            return true;
        } else if (entry.kind === 'directory') {
            const subDirHandle = await dirHandle.getDirectoryHandle(entry.name);
            const subResult = await checkForIndexHtml(subDirHandle, path ? `${path}/${entry.name}` : entry.name);
            if (subResult) return true;
        }
    }
    return false;
}

// Get file from directory handle by path
async function getFileFromPath(dirHandle, path) {
    const parts = path.split('/').filter(part => part !== '');
    
    // Navigate to the correct subdirectory
    let currentHandle = dirHandle;
    for (let i = 0; i < parts.length - 1; i++) {
        try {
            currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
        } catch (err) {
            throw new Error(`Directory not found: ${parts[i]}`);
        }
    }
    
    // Get the file from the current directory
    try {
        const fileName = parts[parts.length - 1];
        const fileHandle = await currentHandle.getFileHandle(fileName);
        return await fileHandle.getFile();
    } catch (err) {
        throw new Error(`File not found: ${parts[parts.length - 1]}`);
    }
}

// Get MIME type based on file extension
function getMimeType(fileName) {
    const extension = fileName.split('.').pop().toLowerCase();
    const mimeTypes = {
        'html': 'text/html',
        'js': 'application/javascript',
        'css': 'text/css',
        'json': 'application/json',
        'wasm': 'application/wasm',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'svg': 'image/svg+xml',
        'ico': 'image/x-icon',
        'ttf': 'font/ttf',
        'otf': 'font/otf',
        'woff': 'font/woff',
        'woff2': 'font/woff2'
    };
    
    return mimeTypes[extension] || 'application/octet-stream';
}

// Function to display folder structure with folder name at the top
async function displayFolderStructure(dirHandle, parentElement, level = 0, rootName = null) {
    if (level === 0 && rootName) {
        const header = document.createElement('div');
        header.className = 'folder-structure-header';
        header.innerHTML = `
            <svg class="icon folder-header-icon" viewBox="0 0 24 24">
                <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
            </svg>
            <span class="folder-header-name">${rootName}</span>
        `;
        parentElement.appendChild(header);
    }
    const container = document.createElement('div');
    container.className = 'folder-structure';
    container.style.marginLeft = `${level * 20}px`;
    for await (const entry of dirHandle.values()) {
        const item = document.createElement('div');
        item.className = 'folder-item';
        if (entry.kind === 'directory') {
            item.innerHTML = `
                <svg class="icon" viewBox="0 0 24 24" style="width: 16px; height: 16px;">
                    <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                </svg>
                ${entry.name}
            `;
            const subDirHandle = await dirHandle.getDirectoryHandle(entry.name);
            await displayFolderStructure(subDirHandle, item, level + 1);
        } else {
            item.innerHTML = `
                <svg class="icon" viewBox="0 0 24 24" style="width: 16px; height: 16px;">
                    <path d="M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z"/>
                </svg>
                ${entry.name}
            `;
        }
        container.appendChild(item);
    }
    parentElement.appendChild(container);
}

// Handle folder selection
async function pickFolder() {
    // Check for File System Access API support
    if (!window.showDirectoryPicker) {
        showStatus('Your browser does not support the File System Access API. Please use the latest version of Chrome.', true);
        return;
    }
    try {
        showStatus('loading');
        // Show the directory picker to let the user select a folder
        const dirHandle = await window.showDirectoryPicker();
        if (!dirHandle) {
            showStatus('No folder selected. Please select a Unity WebGL build folder.', true);
            return;
        }
        // Check if the selected folder contains a Unity WebGL build (index.html)
        const hasIndexHtml = await checkForIndexHtml(dirHandle);
        if (!hasIndexHtml) {
            showStatus('No index.html found in the selected folder. Please select a valid Unity WebGL build folder.', true);
            return;
        }
        // Save the directory handle for later use
        globalDirectoryHandle = dirHandle;
        // Register this tab as having file access
        registerAsFileAccessTab();
        showStatus('Folder selected successfully! Click Play to launch the game.');
        
        // Clear previous folder structure if any
        const existingStructure = document.querySelector('.folder-structure-container');
        if (existingStructure) {
            existingStructure.remove();
        }
        
        // Create and display folder structure
        const structureContainer = document.createElement('div');
        structureContainer.className = 'folder-structure-container';
        structureContainer.style.margin = '20px 0';
        structureContainer.style.padding = '15px';
        structureContainer.style.border = '1px solid #ccc';
        structureContainer.style.borderRadius = '8px';
        structureContainer.style.maxHeight = '300px';
        structureContainer.style.overflow = 'auto';
        // Get folder name
        const folderName = dirHandle.name || 'Selected Folder';
        await displayFolderStructure(dirHandle, structureContainer, 0, folderName);
        // Insert the structure before the play button
        const playButton = document.getElementById('play-button');
        playButton.parentNode.insertBefore(structureContainer, playButton);
        
        // Show the Play button
        playButton.style.display = 'block';
    } catch (err) {
        if (err && err.name === 'AbortError') {
            showStatus('Folder selection was cancelled.', true);
        } else {
            console.error('Error:', err);
            showStatus(err.message || 'An error occurred while processing the WebGL build.', true);
        }
    }
}

// Handle game launch
function launchUnity() {
    if (!globalDirectoryHandle) {
        showStatus('Please select a folder first.', true);
        return;
    }
    chrome.runtime.sendMessage({action: 'launchUnity'}, function(response) {
        if (response && response.success) {
            showStatus('Unity WebGL game launched successfully! Keep this tab open to provide file access.');
        } else {
            showStatus('Failed to launch Unity WebGL game.', true);
        }
    });
}

// Listen for file requests
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.action === 'getFile' && globalDirectoryHandle) {
        // Send immediate response to keep the message channel open
        sendResponse({processing: true});
        try {
            const file = await getFileFromPath(globalDirectoryHandle, message.filePath);
            const contentType = file.type || getMimeType(file.name);
            // Determine if this is a text or binary file
            const isText = contentType.startsWith('text/') || 
                          contentType === 'application/javascript' || 
                          contentType === 'application/json';
            let content;
            if (isText) {
                content = await file.text();
            } else {
                // Convert binary to base64 for transmission
                const arrayBuffer = await file.arrayBuffer();
                const bytes = new Uint8Array(arrayBuffer);
                let binary = '';
                for (let i = 0; i < bytes.byteLength; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                content = btoa(binary);
            }
            chrome.runtime.sendMessage({
                response: true,
                success: true,
                filePath: message.filePath,
                content: content,
                contentType: contentType,
                isText: isText
            });
        } catch (error) {
            chrome.runtime.sendMessage({
                response: true,
                success: false,
                filePath: message.filePath,
                error: error.message
            });
        }
        return true;
    }
});

// Add event listeners
document.addEventListener('DOMContentLoaded', async function() {
    document.getElementById('select-folder').addEventListener('click', pickFolder);
    document.getElementById('play-button').addEventListener('click', launchUnity);
    // Check for File System Access API support on load
    if (!window.showDirectoryPicker) {
        showStatus('Your browser does not support the File System Access API. Please use the latest version of Chrome.', true);
        document.getElementById('select-folder').disabled = true;
        return;
    }
    if (globalDirectoryHandle) {
        registerAsFileAccessTab();
        document.getElementById('play-button').style.display = 'block';
    }
    // Inject Buy Me a Coffee button in top right
    injectBmcButton(document.body, { wrapperClass: 'bmc-topright' });
});