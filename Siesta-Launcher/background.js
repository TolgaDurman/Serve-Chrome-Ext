// Background service worker for Unity WebGL launcher
const DB_NAME = "webglFilesDB";
const STORE_NAME = "files";

// Database Management Module
const DatabaseManager = {
  db: null,

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
    });
  },

  async getFile(filePath) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(filePath);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  },
};

// File Content Management Module
const FileManager = {
  extractedScripts: {},

  registerScript(filename, content) {
    this.extractedScripts[filename] = content;
  },

  base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  },

  getMimeType(fileName) {
    const extension = fileName.split(".").pop().toLowerCase();
    const mimeTypes = {
      html: "text/html",
      js: "application/javascript",
      css: "text/css",
      json: "application/json",
      wasm: "application/wasm",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      svg: "image/svg+xml",
      ico: "image/x-icon",
      ttf: "font/ttf",
      otf: "font/otf",
      woff: "font/woff",
      woff2: "font/woff2",
    };

    return mimeTypes[extension] || "application/octet-stream";
  },

  modifyHtmlContent(htmlContent, filePath) {
    let modifiedContent = htmlContent;
    let scriptCounter = 0;
    const baseDir = filePath.includes("/")
      ? filePath.substring(0, filePath.lastIndexOf("/") + 1)
      : "";

    const inlineScriptRegex =
      /<script(?!\s+src=)([\s\S]*?)>([\s\S]*?)<\/script>/gi;

    modifiedContent = modifiedContent.replace(
      inlineScriptRegex,
      (match, attributes, content) => {
        if (!content.trim()) return match;

        const scriptFileName = `${baseDir}_extracted_script_${scriptCounter++}.js`;
        this.registerScript(scriptFileName, content);

        return `<script${attributes} src="${chrome.runtime.getURL(
          scriptFileName
        )}"></script>`;
      }
    );

    return modifiedContent;
  },
};
const TabsManager = {
  closeIndexTab() {
    const url = self.location.href;
    const indexUrl = url.replace("background.js", "index.html");
    chrome.tabs.query({ url: indexUrl }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.remove(tabs[0].id);
      }
    });
  },
};

// Request Handler Module
const RequestHandler = {
  async handleUnityFileRequest(url) {
    let filePath = url.pathname.replace("/", "");
    if (filePath === "" || filePath === "/") {
      filePath = "index.html";
    }

    if (FileManager.extractedScripts[filePath]) {
      return new Response(FileManager.extractedScripts[filePath], {
        status: 200,
        headers: { "Content-Type": "application/javascript" },
      });
    }

    try {
      const fileContent = await DatabaseManager.getFile(filePath);
      if (!fileContent) {
        console.warn(`File not found in IndexedDB: ${filePath}`);
        return new Response("File not found", { status: 404 });
      }

      const contentType = FileManager.getMimeType(filePath);
      const isText =
        contentType.startsWith("text/") ||
        contentType === "application/javascript" ||
        contentType === "application/json";

      let content;
      if (isText) {
        content = fileContent;
        if (contentType === "text/html") {
          content = FileManager.modifyHtmlContent(content, filePath);
        }
      } else {
        if (
          typeof fileContent === "string" &&
          fileContent.startsWith("data:")
        ) {
          const base64 = fileContent.split(",")[1];
          content = FileManager.base64ToArrayBuffer(base64);
        } else {
          content = fileContent;
        }
      }

      return new Response(content, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cross-Origin-Embedder-Policy": "require-corp",
          "Cross-Origin-Opener-Policy": "same-origin",
        },
      });
    } catch (error) {
      console.error("Error serving Unity file:", error);
      return new Response("Error: " + error.message, { status: 500 });
    }
  },
};

// Cache Management Module
const CacheManager = {
  async clearAll() {
    try {
      await DatabaseManager.close();
      return true;
    } catch (error) {
      console.error("Error clearing cache:", error);
      return false;
    }
  },
};

// Event Listeners
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith("/app/")) {
    event.respondWith(RequestHandler.handleUnityFileRequest(url));
  }
});

// Message Handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "clearCache") {
    TabsManager.closeIndexTab();
    DatabaseManager.close().then(() => sendResponse({ success: true }));
    return true; // Keep the message channel open for the async response
  } else if (message.action === "launchUnity") {
    // Create a new tab with the Unity game
    chrome.tabs.create(
      {
        url: chrome.runtime.getURL("index.html"),
      },
      (tab) => {
        sendResponse({ success: true, tabId: tab.id });
      }
    );
    return true; // Keep the message channel open for the async response
  }
});
