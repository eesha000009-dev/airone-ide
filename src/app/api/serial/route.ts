import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, data, port, baudRate } = body;

    switch (action) {
      case 'connect':
        // In production, open serial port connection
        return NextResponse.json({
          success: true,
          message: `Connected to ${port || '/dev/ttyUSB0'} at ${baudRate || 115200} baud`,
        });

      case 'disconnect':
        return NextResponse.json({
          success: true,
          message: 'Disconnected from serial port',
        });

      case 'send':
        // In production, send data to serial port
        return NextResponse.json({
          success: true,
          message: `Sent: ${data}`,
        });

      default:
        return NextResponse.json(
          { success: false, error: 'Unknown action' },
          { status: 400 }
        );
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Serial operation failed' },
      { status: 500 }
    );
  }
}

export async function GET() {
  // List available serial ports
  return NextResponse.json({
    ports: [
      { path: '/dev/ttyUSB0', manufacturer: 'Silicon Labs', vendorId: '10c4' },
      { path: '/dev/ttyACM0', manufacturer: 'Arduino', vendorId: '2341' },
    ],
  });
}
