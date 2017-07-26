
function PacketBuffer (maxBytes) {
	this.buffer = []
	this.startSeq;
	this.bytes = 0
	this.maxBytes =  maxBytes || 1500 * 1200
	this.maxSeq = 0
}

PacketBuffer.prototype.isEmpty = function() {
	return this.buffer == 0
}

PacketBuffer.prototype.init = function(seq) {
	this.startSeq = seq
	this.maxSeq = seq - 1
}

PacketBuffer.prototype.put = function(seq, elem) {
	let bytes = elem.length
	if(bytes > this.maxBytes - this.bytes) 
		throw new Exception("Full packet buffer")
	
	let index = seq - this.startSeq
	this.maxSeq++;
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

//remove elements with contiguous sequence numbers from beginning to upto or until missing elem
PacketBuffer.prototype.removeSeqs = function(upto) {
	//let remove = []
	if(upto && upto < this.startSeq) return []
	let packs = []
	var i = 0
	//console.log("recieved acks for upto", upto)
	for(; i < this.buffer.length; i++) {
		
		//if(!this.remove(this.startSeq + i))
		if(upto && upto < this.startSeq + i) break 
		if(!this.buffer[i]) break
		//console.log("removing", this.startSeq + i)
		let elem = this.buffer[i]
		let bytes = elem.length
		this.bytes -= bytes
		packs.push(this.buffer.shift())
	}
	this.startSeq += i 
	return packs
}

module.exports = PacketBuffer