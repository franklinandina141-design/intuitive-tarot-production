// The miniature preview and the full picker use the same shuffled deck.
function fanStyle(index) {
  // Match the phone layout: a shallow, centered arc in front of the table.
  const t=index/25;
  const a=(-1.02 + t*2.04);
  // Anchor to the viewport, not a pixel width interpreted as rpx.
  // Subtract half the 66.37rpx card width to center its rotation origin.
  const x=Math.sin(a)*205-33.185;
  const y=142 - Math.cos(a)*58;
  const rotation=a*180/Math.PI;
  return `left:calc(50% + ${x.toFixed(2)}rpx);top:${Math.round(y)}rpx;transform:rotate(${rotation.toFixed(1)}deg);animation-delay:${Math.abs(index-12.5)*25}ms`;
}
function pickerStyle(index,scrollLeft,width) {
  const cardWidth=width*.35,step=cardWidth+14;
  const d=(index*step-scrollLeft)/width;
  return `transform:translateY(${Math.min(24,d*d*30)}px) rotate(${Math.max(-1.5,Math.min(1.5,d))*9}deg)`;
}
module.exports={fanStyle,pickerStyle};
