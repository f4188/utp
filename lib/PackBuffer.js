
function PacketBuffer (maxBytes) {
	this.buffer = []
	this.startSeq;
	this.bytes = 0
	this.maxBytes =  maxBytes || 1500 * 30
}

PacketBuffer.prototype.init = function(seq) {
	this.startSeq = seq
}

PacketBuffer.prototype.put = function(seq, elem) {
	let bytes = elem.length
	if(bytes > this.maxBytes - this.bytes) 
		throw new Exception("Full packet buffer")
	//if(this.buffer.length == 0)
	//	this.startSeq = seq
	//let index = seq - this.startSeq
	//if(index > this.buffer.length)
	let index = seq - this.startSeq

	this.buffer[index] = elem
	this.bytes += bytes
	return this
}

PacketBuffer.prototype.get = function(seq) {
	let index = seq - this.startSeq;
	if(index > this.buffer.length)
		return undefined
	return this.buffer[index]
}

PacketBuffer.prototype.remove = function(seq) {
	let index = this.startSeq - seq
	if(index > this.buffer.length) return false
	
	if(this.buffer[index]) {
		let bytes = this.buffer[index].length
		this.bytes -= bytes
		this.buffer[index] = undefined
		return true
	}
	return false
		
}

PacketBuffer.prototype.removSeqs = function() {
	let remove = []
	var i = 0
	for(; i < this.buffer.length; i++) {
		if(!this.remove(this.startSeq + i))
			break;
	}
	this.startSeq += i
	return i
}

module.exports = PacketBuffer