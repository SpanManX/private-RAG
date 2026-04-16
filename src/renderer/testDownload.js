const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * 从 ModelScope 下载单个文件
 * @param {string} modelPath - 模型 ID (例如: "ZhipuAI/chatglm3-6b-gguf")
 * @param {string} fileName - 要下载的文件名 (例如: "chatglm3-6b-q4_0.gguf")
 * @param {string} saveDir - 本地保存目录
 * @param {function} onProgress - 进度回调函数
 */
async function downloadFromModelScope(modelPath, fileName, saveDir, onProgress) {
    // 1. 构建 ModelScope 的原始下载链接
    // 格式：https://modelscope.cn
    const url = `https://modelscope.cn{modelPath}/repo?Revision=master&FilePath=${fileName}`;
    console.log("正在请求 URL:", url);
    const localPath = path.join(saveDir, fileName);

    // 确保目录存在
    if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
    }

    const writer = fs.createWriteStream(localPath);

    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
    });

    const totalLength = parseInt(response.headers['content-length'], 10);
    let downloadedLength = 0;

    response.data.on('data', (chunk) => {
        downloadedLength += chunk.length;
        if (onProgress) {
            const progress = (downloadedLength / totalLength * 100).toFixed(2);
            onProgress(parseFloat(progress));
        }
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(localPath));
        writer.on('error', reject);
    });
}

// --- 使用示例 ---
const modelId = 'ZhipuAI/chatglm3-6b-gguf';
const file = 'chatglm3-6b-q4_0.gguf';
const dest = './models';

console.log('开始下载...');
downloadFromModelScope(modelId, file, dest, (progress) => {
    process.stdout.write(`\r当前进度: ${progress}%`);
})
    .then((path) => console.log('\n下载完成，路径:', path))
    .catch((err) => console.error('\n下载失败:', err));
