import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, context } = body;

    if (!message) {
      return NextResponse.json(
        { success: false, error: 'No message provided' },
        { status: 400 }
      );
    }

    // In production, this would call the brain-server AI backend
    // or use the z-ai-web-dev-sdk for LLM chat completions
    // For now, return a contextual .airo programming response

    const responses: Record<string, string> = {
      pin: `In .airo, you define hardware pins using the \`pin defi\` block:\n\n\`\`\`\npin defi {\n    ledpin = 2; output.\n    sensor = 35; input.\n}\n\`\`\`\n\nEach pin has:\n- A name (e.g., \`ledpin\`)\n- A pin number (e.g., \`2\` for GPIO2)\n- A mode: \`input\` (senses) or \`output\` (acts)`,
      loop: `The main robot loop is the heart of every .airo program:\n\n\`\`\`\nloop {\n    # Phase 1: SENSE\n    read_for(1000) {\n        sensor_name.\n    }\n\n    # Phase 2: THINK\n    senddatato(brain_url).\n\n    # Phase 3: ACT\n    actfor(1000) {\n        output_name.\n    }\n}\n\`\`\`\n\nThe SENSE → THINK → ACT cycle runs continuously.`,
      senddatato: `\`senddatato(url)\` sends all sensor data to your AI brain via WebSocket:\n\n\`\`\`\n#variables#\nbrain_url = "wss://your-brain.local:8080".\ncall brain_url.\n\nloop {\n    read_for(1000) {\n        temperature.\n    }\n    senddatato(brain_url).  # Sends: "temperature: 28.5"\n    actfor(1000) {\n        ledpin.\n    }\n}\n\`\`\`\n\nThe brain receives sensor data and returns actuator commands.`,
    };

    // Find the best matching response
    let response =
      'I can help you with .airo programming! Try asking about:\n- Pin definitions (`pin defi`)\n- Robot loops (`loop`)\n- Brain communication (`senddatato`)\n- Sensor reading (`read_for`)\n- Actuator control (`actfor`)';

    for (const [key, value] of Object.entries(responses)) {
      if (message.toLowerCase().includes(key)) {
        response = value;
        break;
      }
    }

    return NextResponse.json({
      success: true,
      response,
      timestamp: Date.now(),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'AI chat failed' },
      { status: 500 }
    );
  }
}
