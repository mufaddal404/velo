function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    let parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    
    return parts.join(' ');
}

// Robust Single-Pass Syntax Highlighter
function highlightCode(code) {
    // 1. Escape HTML special characters
    let escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    
    // 2. Define tokens (Comments, Strings, Keywords, Functions)
    // Fixed: string regex now handles escaped characters (e.g. 'It\'s')
    // Fixed: function regex now allows optional whitespace before parenthesis
    const regex = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\b(?:import|from|const|let|var|async|await|try|catch|if|else|return|new|class|export|default|function|process|next|static)\b|\b[a-zA-Z_$]\w*(?=\s*\())/g;

    const keywords = ['import','from','const','let','var','async','await','try','catch','if','else','return','new','class','export','default','function','process','next','static'];

    // 3. Process in a single pass to prevent double-highlighting
    return escaped.replace(regex, (match) => {
        if (match.startsWith('//') || match.startsWith('/*')) {
            return `<span class="token comment">${match}</span>`;
        }
        if (match.startsWith("'") || match.startsWith('"') || match.startsWith('`')) {
            return `<span class="token string">${match}</span>`;
        }
        if (keywords.includes(match)) {
            return `<span class="token keyword">${match}</span>`;
        }
        // If it matches the regex but isn't a keyword/string/comment, it's a function
        return `<span class="token function">${match}</span>`;
    });
}

async function updateData() {
    try {
        const statsRes = await fetch('/api/stats');
        const stats = await statsRes.json();
        
        document.getElementById('uptime').textContent = formatUptime(stats.uptime);
        document.getElementById('memory-rss').textContent = (stats.memory.rss / 1024 / 1024).toFixed(1) + 'MB';
        document.getElementById('memory-heap').textContent = (stats.memory.heapUsed / 1024 / 1024).toFixed(2) + 'MB';

        const headersRes = await fetch('/api/headers');
        const headers = await headersRes.json();
        document.getElementById('headers-display').textContent = JSON.stringify(headers, null, 2);
    } catch (e) {
        console.error('Connection to Velo lost.');
    }
}

// Benchmark Logic
document.getElementById('iterations').addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    const group = e.target.closest('.input-group');
    if (isNaN(val) || val < 1 || val > 100) {
        group.classList.add('invalid');
    } else {
        group.classList.remove('invalid');
    }
});

document.getElementById('test-btn').addEventListener('click', async () => {
    const btn = document.getElementById('test-btn');
    const bar = document.getElementById('latency-bar');
    const resDiv = document.getElementById('result');
    const iterationsInput = document.getElementById('iterations');
    
    let iterations = parseInt(iterationsInput.value) || 10;
    
    if (iterations < 1 || iterations > 100) {
        resDiv.textContent = "OUT OF RANGE (1-100)";
        return;
    }
    
    btn.disabled = true;
    resDiv.textContent = `SYNCING (${iterations}x)...`;
    
    let totalTime = 0;

    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await fetch('/api/stats');
        totalTime += (performance.now() - start);
        bar.style.width = ((i + 1) / iterations * 100) + '%';
    }

    const avg = totalTime / iterations;
    resDiv.textContent = `LATENCY: ${avg.toFixed(2)}ms`;
    btn.disabled = false;
    
    setTimeout(() => { bar.style.width = '0%'; }, 1000);
});

// Kernel Vision Logic
const themeSelector = document.getElementById('theme-selector');
const display = document.getElementById('source-display');
let lastFetchedCode = '';

themeSelector.addEventListener('change', (e) => {
    display.className = e.target.value;
    if (lastFetchedCode) {
        if (e.target.value === 'classic') {
            display.textContent = lastFetchedCode;
        } else {
            display.innerHTML = highlightCode(lastFetchedCode);
        }
    }
});

document.getElementById('view-source-btn').addEventListener('click', async () => {
    const btn = document.getElementById('view-source-btn');
    const container = document.getElementById('source-container');

    if (container.classList.contains('hidden')) {
        btn.textContent = "REVEALING...";
        try {
            const res = await fetch('/api/source');
            lastFetchedCode = await res.text();
            
            display.className = themeSelector.value;
            
            if (themeSelector.value === 'classic') {
                display.textContent = lastFetchedCode;
            } else {
                display.innerHTML = highlightCode(lastFetchedCode);
            }
            
            container.classList.remove('hidden');
            btn.textContent = "HIDE CODE";
        } catch (e) {
            btn.textContent = "SYNC ERROR";
        }
    } else {
        container.classList.add('hidden');
        btn.textContent = "REVEAL RUNNING CODE";
    }
});

setInterval(updateData, 5000);
updateData();
