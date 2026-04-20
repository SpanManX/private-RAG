import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function getCUDAInfo() {
    try {
        // 执行 nvidia-smi
        const { stdout } = await execAsync('nvidia-smi');

        // 提取版本号
        const versionMatch = stdout.match(/CUDA Version:\s+(\d+\.\d+)/);
        // 提取显卡型号（例如 RTX 4070）
        const nameMatch = stdout.match(/NVIDIA GeForce\s+([^|]+)/);

        return {
            available: true,
            version: versionMatch ? versionMatch[1] : 'Unknown',
            model: nameMatch ? nameMatch[0].trim() : 'NVIDIA GPU',
            raw: stdout
        };
    } catch (error) {
        return {
            available: false,
            version: null,
            error: '未检测到 NVIDIA 驱动'
        };
    }
}