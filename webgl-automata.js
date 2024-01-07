const vertexSource = `#version 300 es
in vec4 inVertexPosition;
out vec2 texturePosition;
void main() {
  gl_Position=inVertexPosition;
  texturePosition=(inVertexPosition.xy + 1.0)/2.0; // convert from clip space to texture coordinates ([-1, 1] => [0, 1]).
}
`

const fragmentCopySource = `#version 300 es
precision lowp float;
in vec2 texturePosition;
uniform sampler2D uTexture;
out vec4 outColor;
void main() {
  vec4 state = texture(uTexture, texturePosition);
  if (int(state.x) == 1) {
    outColor = vec4(0.607, 0.588, 0.690, 1.0);
  } else {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
  }
}
`

const fragmentAutomataSource=`#version 300 es
precision lowp float;
in vec2 texturePosition;
uniform vec2 canvasSize;
uniform sampler2D uTexture;
out vec4 outColor;

int get(float x, float y) {
  float onePixelRight = 1.0/canvasSize.x;
  float onePixelUp = 1.0/canvasSize.y;
  return int(texture(uTexture, (texturePosition + vec2(x*onePixelRight,y*onePixelUp))).x);
}

void main() {
  int sum = get(-1.0, -1.0) +
            get(-1.0,  0.0) +
            get(-1.0,  1.0) +
            get( 0.0, -1.0) +
            get( 0.0,  0.0) +
            get( 0.0,  1.0) +
            get( 1.0, -1.0) +
            get( 1.0,  0.0) +
            get( 1.0,  1.0);
  if (sum == 4) {
    outColor = vec4(1.0, 1.0, 1.0, 1.0);
  } else if (sum == 5) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
  } else {
    if (sum < 4) {
      outColor = vec4(0.0, 0.0, 0.0, 1.0);
    } else {
      outColor = vec4(1.0, 1.0, 1.0, 1.0);
    }
  }
}
`

class SpotsAutomata {
    constructor(canvasSelector) {
	const canvas = document.querySelector(canvasSelector)
	const gl = this.gl = canvas.getContext("webgl2")
	if (this.gl === null) {
	    console.error("No webgl2 support. (T-T)")
	} else {
	    resizeCanvasToDisplaySize(gl.canvas)
	    gl.viewport(0,0,gl.canvas.width,gl.canvas.height)

	    gl.disable(gl.DEPTH_TEST);
	    gl.disable(gl.BLEND);
	    gl.disable(gl.STENCIL_TEST);
	    gl.disable(gl.CULL_FACE);

	    this.copyProgram = createProgram(gl, vertexSource, fragmentCopySource)
	    this.stepProgram = createProgram(gl, vertexSource, fragmentAutomataSource)
	    this.backTexture = createTexture(gl, gl.canvas.width, gl.canvas.height)
	    this.frontTexture = createTexture(gl, gl.canvas.width, gl.canvas.height)
	    this.swapFramebuffer = this.gl.createFramebuffer()

	    // We draw the same fullscreen rectangle every step so we
	    // can initialize the vertex shader arguments at this time.
	    const positionBuffer = gl.createBuffer()
	    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
	    const positions = [
		-1, -1,
		-1,  1,
		1,   1,
		1,   1,
		1,  -1,
		-1, -1,
	    ]
	    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW)
	    gl.bindVertexArray(gl.createVertexArray())
	    for (const program of [this.copyProgram, this.stepProgram]) {
		const size = 2
		const type = gl.FLOAT
		const normalize = false
		const stride = 0
		const offset = 0
		const pal = gl.getAttribLocation(program, "inVertexPosition")
		gl.enableVertexAttribArray(pal)
		gl.vertexAttribPointer(pal, size, type, normalize, stride, offset)
	    }

	    gl.useProgram(this.stepProgram)
	    let sizePosition = gl.getUniformLocation(this.stepProgram, "canvasSize")
	    gl.uniform2f(sizePosition, gl.canvas.width, gl.canvas.height)
	    gl.useProgram(null)

	    // To resize a texture, (1) create a new texture with the
	    // desired dimensions, (2) draw old texture to new
	    // texture.
	    window.addEventListener("resize", this.resize)
	}
    }

    step = () => {
	const gl=this.gl
	// 1. Using swap framebuffer, using back texture as state,
	//    draw update to automata to front texture.
	this.writeToTexture(
	    this.stepProgram,
	    this.swapFramebuffer,
	    this.frontTexture,
	    this.backTexture,
	)
	// 2. Draw front texture
	this.drawTexture(this.frontTexture)
	// 3. Swap front and back textures and goto (1)
	const tmp = this.backTexture
	this.backTexture = this.frontTexture
	this.frontTexture = tmp
    }

    drawTexture = (texture) => {
	const gl=this.gl
	const program=this.copyProgram
	gl.useProgram(program)
	gl.bindFramebuffer(gl.FRAMEBUFFER, null)
	const samplerLocation = gl.getUniformLocation(program, "uTexture")
	gl.activeTexture(gl.TEXTURE0+texture.index)
	gl.bindTexture(gl.TEXTURE_2D, texture.texture)
	gl.uniform1i(samplerLocation, texture.index)
	gl.drawArrays(gl.TRIANGLES,0,6)
    }

    writeToTexture = (program, framebuffer, toTexture, fromTexture) => {
	const gl=this.gl
	gl.useProgram(program)
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
	gl.framebufferTexture2D(
	    gl.FRAMEBUFFER,
	    gl.COLOR_ATTACHMENT0,
	    gl.TEXTURE_2D,
	    toTexture.texture,
	    0,
	)
	let samplerLocation = gl.getUniformLocation(program, "uTexture")
	gl.activeTexture(gl.TEXTURE0+fromTexture.index)
	gl.bindTexture(gl.TEXTURE_2D, fromTexture.texture)
	gl.uniform1i(samplerLocation, fromTexture.index)
	gl.drawArrays(gl.TRIANGLES,0,6)
    }

    resize = () => {
	const gl = this.gl
	resizeCanvasToDisplaySize(gl.canvas)

	let t = createTexture(gl, gl.canvas.width, gl.canvas.height, 3)
	this.writeToTexture(
	    this.stepProgram,
	    this.swapFramebuffer,
	    t,
	    this.backTexture,
	)
	gl.deleteTexture(this.backTexture.texture)
	this.backTexture.texture = t.texture

	t = createTexture(gl, gl.canvas.width, gl.canvas.height, 3)
	this.writeToTexture(
	    this.stepProgram,
	    this.swapFramebuffer,
	    t,
	    this.frontTexture,
	)
	gl.deleteTexture(this.frontTexture.texture)
	this.frontTexture.texture = t.texture

	gl.useProgram(this.stepProgram)
	let sizePosition = gl.getUniformLocation(this.stepProgram, "canvasSize")
	gl.uniform2f(sizePosition, gl.canvas.width, gl.canvas.height)
	gl.useProgram(null)
	gl.viewport(0,0,gl.canvas.width,gl.canvas.height)
    }
}

const createProgram = (gl, vertexShaderSource, fragmentShaderSource) => {
    const createShader = (gl, shaderType, source) => {
	const shader = gl.createShader(shaderType)
	gl.shaderSource(shader, source)
	gl.compileShader(shader)
	const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS)

	if (success) {
	    return shader
	} else {
	    console.error(gl.getShaderInfoLog(shader))
	    gl.deleteShader(shader)
	    return
	}
    }

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)

    const program = gl.createProgram()
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    const success = gl.getProgramParameter(program, gl.LINK_STATUS)

    if (success) {
	return program
    } else {
	console.error(gl.getProgramInfoLog(program))
	gl.deleteProgram(program)
	return
    }
}

const createTexture = (() => {
    let textureCount = 0
    const genRandomTextureData = (width,height) => {
	const pixels = new Uint8Array(width * height * 4)
	for (let i=0;i<pixels.length;i+=4) {
	    const color = Math.random() < 0.5 ? 255 : 0
	    pixels[i] = color
	    pixels[i+1] = color
	    pixels[i+2] = color
	    pixels[i+3] = 255
	}
	return pixels
    }
    return (gl,width,height,index=textureCount) => {
	const texture = gl.createTexture()
	gl.activeTexture(gl.TEXTURE0+index)
	gl.bindTexture(gl.TEXTURE_2D, texture)
	const pixels = genRandomTextureData(width,height)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
	gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
	textureCount+=1
	return {
	    index: index,
	    texture: texture
	}
    }
})()

const resizeCanvasToDisplaySize = (canvas) => {
    const displayWidth = canvas.clientWidth
    const displayHeight = canvas.clientHeight

    const needResize = canvas.width !== displayWidth || canvas.height !== displayHeight
    if (needResize) {
	canvas.width = displayWidth
	canvas.height = displayHeight
    }
    return needResize
}

const automata = window.automata = new SpotsAutomata("#glcanvas")

const runAtFps = (fps, fn) => {
    const f = (spacing, lastTime, fn) => {
	const now = Date.now()
	if (now - lastTime >= spacing) {
	    fn()
	    f(spacing, now, fn)
	} else {
	    setTimeout(() => f(spacing, lastTime, fn), spacing + lastTime - now)
	}
    }
    const spacing = 1/fps * 1000
    f(spacing, 0, fn)
}

runAtFps(60, () => automata.step())
