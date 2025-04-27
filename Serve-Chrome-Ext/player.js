// We'll keep most of the UI handling the same
function showStatus(message, isError = false) {
    const status = document.getElementById('status');
    const button = document.getElementById('select-folder');
    
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

// Global folder handle that we can use across the session
let globalFolderHandle = null;

async function traverseDirectory(dirHandle, path = '') {
    const files = [];

    for await (const entry of dirHandle.values()) {
        const entryPath = path ? `${path}/${entry.name}` : entry.name;

        if (entry.kind === 'file') {
            const fileHandle = await dirHandle.getFileHandle(entry.name);
            const file = await fileHandle.getFile();
            const content = file.type.startsWith('text/') || file.type === 'application/json' || file.type === 'application/javascript'
                ? await file.text()
                : await file.arrayBuffer();

            files.push({
                path: entryPath,
                content,
                contentType: file.type
            });
        } else if (entry.kind === 'directory') {
            const subDirHandle = await dirHandle.getDirectoryHandle(entry.name);
            const subFiles = await traverseDirectory(subDirHandle, entryPath);
            files.push(...subFiles);
        }
    }

    return files;
}

async function pickFolderAndLaunchUnity() {
    try {
        const dirHandle = await window.showDirectoryPicker();

        // Traverse the directory and collect all files
        const files = await traverseDirectory(dirHandle);

        // Store files in sessionStorage for further usage
        const filesMap = files.reduce((acc, file) => {
            acc[file.path] = {
                content: file.content,
                contentType: file.contentType
            };
            return acc;
        }, {});
        sessionStorage.setItem('unityFiles', JSON.stringify(filesMap));
    } catch (err) {
        console.error('Error:', err);
    }
}

document.getElementById('select-folder').addEventListener('click', pickFolderAndLaunchUnity);