let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    const command = JSON.parse(line);
    if (command.type === "prompt") {
      respond(command, "prompt");
      setTimeout(() => process.exit(23), 20);
    } else if (command.type === "get_state") {
      process.stdout.write(
        `${JSON.stringify({
          id: command.id,
          type: "response",
          command: "get_state",
          success: true,
          data: {
            thinkingLevel: "off",
            isStreaming: true,
            isCompacting: false,
            steeringMode: "one-at-a-time",
            followUpMode: "one-at-a-time",
            sessionId: "fake",
            autoCompactionEnabled: false,
            messageCount: 0,
            pendingMessageCount: 0,
          },
        })}\n`,
      );
    }
  }
});

function respond(command, type) {
  process.stdout.write(
    `${JSON.stringify({
      id: command.id,
      type: "response",
      command: type,
      success: true,
    })}\n`,
  );
}
