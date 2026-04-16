const { ChatOpenAI } = require("@langchain/openai");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");

async function callLocalModel() {
    console.log("调用本地模型...");
    // 1. 初始化模型实例
    const model = new ChatOpenAI({
        // 指向 llama-server 的地址
        configuration: {
            baseURL: "http://127.0.0.1:8080",
        },
        // 本地模型不需要真正的 API Key，但 LangChain 要求必须传个字符串
        apiKey: "not-needed",
        // 对应你模型支持的参数
        modelName: "local-model",
        temperature: 0.7,
        // streaming: true, // 如果需要流式输出可以开启
    });

    try {
        // 2. 发送消息
        const response = await model.invoke([
            new SystemMessage("你是一个专业的助手。"),
            new HumanMessage("你是什么大模型"),
        ]);

        console.log("模型回复:", response.content);
        return response.content;
    } catch (error) {
        console.error("调用失败:", error.message);
    }
}

callLocalModel();
