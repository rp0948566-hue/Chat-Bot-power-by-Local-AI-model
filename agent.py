import os
import ollama

EXTENSIONS = (".py", ".js", ".ts", ".tsx", ".html", ".css", ".json")

def read_code():
    data = ""

    for root, _, files in os.walk("."):
        for file in files:
            if file.endswith(EXTENSIONS):
                path = os.path.join(root, file)

                try:
                    with open(path, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read()

                        if len(content) > 1500:
                            content = content[:1500] + "\n... [truncated]"

                        data += f"\n--- {path} ---\n"
                        data += content

                except:
                    pass

    return data


code = read_code()

response = ollama.chat(
    model="qwen2.5-coder:7b",
    messages=[
        {
            "role": "user",
            "content": f"""
You are analyzing a full project.

Understand:
- architecture
- file relationships
- logic

Here is the code:
{code}
"""
        }
    ]
)

print(response["message"]["content"])